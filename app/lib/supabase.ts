// Supabase client + cloud-sync layer.
//
// V1 wraps the existing localStorage entity pipeline rather than
// replacing it. The salon owner keeps using the app exactly as before;
// cloud sync just guarantees their data lives somewhere durable and
// follows them across devices.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bjqazhplxqqhftekspfl.supabase.co";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_b-GByxuYeehWa-9F7Z1MdQ_FKqx32XO";

let _client: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient => {
  if (_client) return _client;
  _client = createClient(URL, ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "bbp-auth",
    },
  });
  return _client;
};

// ---- Sync table descriptors --------------------------------------------
// Each entity in the app has a localStorage prefix and a Supabase table.
// Promoted columns are extracted from the record so we get indexed
// querying; everything else round-trips through `data jsonb`. Anything
// that wasn't promoted to a column lives entirely inside `data`.

export type SyncTable =
  | "clients"
  | "appointments"
  | "quotes"
  | "receipts"
  | "communications"
  | "notifications"
  | "photos"
  | "business_expenses"
  | "inventory_items"
  | "inventory_movements"
  | "payment_transactions";

// What columns each table has beyond the standard (user_id, id,
// data, created_at, updated_at). Used to build the upsert payload.
type ColumnMap = Record<string, (rec: any) => any>;

const cleanString = (v: any): string | null => {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
};
const cleanNumber = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const cleanBool = (v: any): boolean => v === true;
const cleanDate = (v: any): string | null => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const TABLE_COLUMNS: Record<SyncTable, ColumnMap> = {
  clients: {
    name: r => cleanString(r.name),
    phone: r => cleanString(r.phone),
    email: r => cleanString(r.email),
    preferred_styles: r => (Array.isArray(r.preferredStyles) ? r.preferredStyles : null),
    scalp_sensitivity: r => cleanString(r.scalpSensitivity),
    allergies: r => cleanString(r.allergies),
    notes: r => cleanString(r.notes),
    // Marketing automation V2 — birthday (date, MM-DD matters; year
    // doesn't) and per-client opt-out. Sync layer round-trips both.
    birthday: r => cleanDate(r.birthday),
    marketing_emails_enabled: r => cleanBool(r.marketingEmailsEnabled ?? true),
    // Referral payouts V1 — which client referred this one.
    referred_by_client_id: r => cleanString(r.referredByClientId),
  },
  appointments: {
    client_id: r => cleanString(r.clientId),
    client_name: r => cleanString(r.clientName),
    client_phone: r => cleanString(r.clientPhone),
    client_email: r => cleanString(r.clientEmail),
    style: r => cleanString(r.style),
    appt_date: r => cleanDate(r.date),
    appt_time: r => cleanString(r.time),
    duration_hours: r => (r.durationHours == null || r.durationHours === "" ? null : cleanNumber(r.durationHours)),
    total_price: r => cleanNumber(r.totalPrice),
    deposit_paid: r => cleanNumber(r.depositPaid),
    balance_due: r => cleanNumber(r.balanceDue),
    status: r => cleanString(r.status) || "scheduled",
    payment_status: r => cleanString(r.paymentStatus),
    payment_method: r => cleanString(r.paymentMethod),
    payment_date: r => cleanDate(r.paymentDate),
    payment_notes: r => cleanString(r.paymentNotes),
    notes: r => cleanString(r.notes),
    series_id: r => cleanString(r.seriesId),
    // Links the sessions of one multi-day/split booking (e.g. a long
    // install started one day, finished the next). Shared across every
    // session's row; distinct from series_id, which links independent
    // recurring occurrences instead. See 20261265000000_multi_day_appointments.sql.
    multi_day_group_id: r => cleanString(r.multiDayGroupId),
    discount_id: r => cleanString(r.discountId),
    discount_name: r => cleanString(r.discountName),
    discount_amount: r => (r.discountAmount == null ? null : cleanNumber(r.discountAmount)),
    kind: r => cleanString(r.kind) || "appointment",
    service_id: r => cleanString(r.serviceId),
    source: r => cleanString(r.source),
    referral_source: r => cleanString(r.referralSource),
    timezone: r => cleanString(r.timezone),
    locale: r => cleanString(r.locale),
    created_from_public: r => cleanBool(r.createdFromPublic),
    is_all_day: r => cleanBool(r.isAllDay),
    blocks_availability: r => r.blocksAvailability === false ? false : true,
    // SMS reminders — the stylist's opt-in for this appointment's
    // client. The reminder cron + confirmation RPC gate on it.
    // sms_opt_in_at / sms_consent_source / last_reminder_sent_at are
    // server-managed (trigger + cron), so they're deliberately not
    // synced from the client.
    sms_opt_in: r => cleanBool(r.smsOptIn),
  },
  quotes: {
    label: r => cleanString(r.label),
    style: r => cleanString(r.style),
    client_id: r => cleanString(r.clientId),
    total_price: r => (r.totalPrice == null ? null : cleanNumber(r.totalPrice)),
    final_price: r => (r.finalPrice == null ? null : cleanNumber(r.finalPrice ?? r.breakdown?.finalPrice)),
    inputs: r => r.inputs ?? {},
    breakdown: r => r.breakdown ?? {},
    saved_at: r => cleanString(r.savedAt),
    discount_id: r => cleanString(r.discountId),
    discount_name: r => cleanString(r.discountName),
    discount_amount: r => (r.discountAmount == null ? null : cleanNumber(r.discountAmount)),
  },
  receipts: {
    receipt_number: r => cleanString(r.receiptNumber),
    appointment_id: r => cleanString(r.appointmentId),
    client_id: r => cleanString(r.clientId),
    client_name: r => cleanString(r.clientName),
    amount_collected: r => cleanNumber(r.amountCollected),
    payment_status: r => cleanString(r.paymentStatus),
    payment_method: r => cleanString(r.paymentMethod),
    notes: r => cleanString(r.notes),
  },
  communications: {
    template_key: r => cleanString(r.type),
    action: r => cleanString(r.action) || "draft",
    client_id: r => cleanString(r.clientId),
    appointment_id: r => cleanString(r.appointmentId),
    body: r => cleanString(r.body),
  },
  notifications: {
    category: r => cleanString(r.category),
    title: r => cleanString(r.title),
    body: r => cleanString(r.body),
    dismissed: r => cleanBool(r.dismissed),
    read_at: r => cleanString(r.readAt),
  },
  photos: {
    client_id: r => cleanString(r.clientId),
    appointment_id: r => cleanString(r.appointmentId),
    category: r => cleanString(r.category),
    caption: r => cleanString(r.caption),
    taken_at: r => cleanDate(r.takenAt),
    is_favorite: r => cleanBool(r.isFavorite),
    storage_path: r => cleanString(r.storagePath),
    thumbnail_path: r => cleanString(r.thumbnailPath),
  },
  business_expenses: {
    title: r => cleanString(r.title),
    amount: r => cleanNumber(r.amount),
    category: r => cleanString(r.category),
    note: r => cleanString(r.note),
    expense_date: r => cleanDate(r.expenseDate ?? r.date),
    is_recurring: r => cleanBool(r.isRecurring),
    recurring_interval: r => cleanString(r.recurringInterval),
    next_billing_date: r => cleanDate(r.nextBillingDate),
    receipt_path: r => cleanString(r.receiptPath),
  },
  // Inventory items get their on-hand quantity here for fast reads,
  // but the canonical mutation path for quantity is the
  // inventory_apply_movement RPC — never edit quantity_on_hand from
  // the upsert payload at runtime; only the RPC bumps it.
  inventory_items: {
    name: r => cleanString(r.name),
    sku: r => cleanString(r.sku),
    category: r => cleanString(r.category),
    unit: r => cleanString(r.unit),
    unit_cost: r => cleanNumber(r.unitCost),
    retail_price: r => (r.retailPrice == null || r.retailPrice === "" ? null : cleanNumber(r.retailPrice)),
    quantity_on_hand: r => cleanNumber(r.quantityOnHand),
    low_stock_threshold: r => cleanNumber(r.lowStockThreshold),
    supplier: r => cleanString(r.supplier),
    photo_path: r => cleanString(r.photoPath),
    storefront_product_id: r => cleanString(r.storefrontProductId),
    // "retail" | "service" | "both" — store stock vs. service supplies.
    // Falls back to "retail" so legacy/unset records stay sellable.
    item_type: r => cleanString(r.itemType) || "retail",
    archived_at: r => cleanString(r.archivedAt),
  },
  // Manual payment ledger (Cash / Zelle / Cash App / Venmo and one-off
  // corrections). Stripe charges + appointment deposits live elsewhere;
  // this table only stores what nothing else owns. Promoted columns
  // mirror the table so the Payments list can query without parsing
  // data jsonb.
  payment_transactions: {
    appointment_id: r => cleanString(r.appointmentId),
    client_id: r => cleanString(r.clientId),
    client_name: r => cleanString(r.clientName),
    service_name: r => cleanString(r.serviceName),
    amount: r => cleanNumber(r.amount),
    tip_amount: r => cleanNumber(r.tipAmount),
    payment_type: r => cleanString(r.paymentType) || "full",
    payment_method: r => cleanString(r.paymentMethod) || "cash",
    paid_at: r => cleanString(r.paidAt),
    note: r => cleanString(r.note),
  },
  // Movements are append-only — we never round-trip an update on
  // them. The promoted columns mirror the table so list views can
  // filter by reason or item without parsing data jsonb.
  inventory_movements: {
    item_id: r => cleanString(r.itemId),
    delta: r => cleanNumber(r.delta),
    reason: r => cleanString(r.reason),
    appointment_id: r => cleanString(r.appointmentId),
    storefront_order_id: r => cleanString(r.storefrontOrderId),
    business_expense_id: r => cleanString(r.businessExpenseId),
    unit_cost_snapshot: r => (r.unitCostSnapshot == null ? null : cleanNumber(r.unitCostSnapshot)),
    note: r => cleanString(r.note),
  },
};

// Build a row payload for upsert. Promoted fields come out as columns;
// the full record (minus the columns) goes into the data jsonb so
// nothing is lost.
export const toCloudRow = (table: SyncTable, userId: string, record: any): Record<string, any> => {
  const cols = TABLE_COLUMNS[table];
  const promoted = Object.keys(cols);
  const dataBlob: Record<string, any> = {};
  for (const k of Object.keys(record || {})) {
    if (k === "id" || k === "user_id" || k === "createdAt" || k === "updatedAt") continue;
    dataBlob[k] = record[k];
  }
  const row: Record<string, any> = {
    user_id: userId,
    id: String(record?.id ?? ""),
    data: dataBlob,
  };
  for (const c of promoted) row[c] = cols[c](record);
  if (record?.createdAt) row.created_at = record.createdAt;
  return row;
};

// Reverse direction: cloud row → app entity shape. We start from the
// data blob (which has the original camelCase keys) and overlay the
// promoted columns + id so the in-app code keeps reading the same
// fields it always has.
export const fromCloudRow = (table: SyncTable, row: any): any => {
  if (!row) return row;
  const base = (row.data && typeof row.data === "object") ? { ...row.data } : {};
  base.id = row.id;
  base.createdAt = base.createdAt || row.created_at;
  base.updatedAt = row.updated_at;
  switch (table) {
    case "clients":
      base.name = row.name ?? base.name;
      base.phone = row.phone ?? base.phone;
      base.email = row.email ?? base.email;
      base.preferredStyles = row.preferred_styles ?? base.preferredStyles ?? [];
      base.scalpSensitivity = row.scalp_sensitivity ?? base.scalpSensitivity;
      base.birthday = row.birthday ?? base.birthday;
      base.marketingEmailsEnabled = row.marketing_emails_enabled ?? base.marketingEmailsEnabled ?? true;
      base.referredByClientId = row.referred_by_client_id ?? base.referredByClientId;
      base.allergies = row.allergies ?? base.allergies;
      base.notes = row.notes ?? base.notes;
      break;
    case "appointments":
      base.clientId = row.client_id ?? base.clientId;
      base.clientName = row.client_name ?? base.clientName;
      base.clientPhone = row.client_phone ?? base.clientPhone;
      base.clientEmail = row.client_email ?? base.clientEmail;
      base.style = row.style ?? base.style;
      base.date = row.appt_date ?? base.date;
      base.time = row.appt_time ?? base.time;
      base.durationHours = row.duration_hours ?? base.durationHours;
      base.totalPrice = row.total_price ?? base.totalPrice;
      base.depositPaid = row.deposit_paid ?? base.depositPaid;
      base.balanceDue = row.balance_due ?? base.balanceDue;
      base.status = row.status ?? base.status;
      base.paymentStatus = row.payment_status ?? base.paymentStatus;
      base.paymentMethod = row.payment_method ?? base.paymentMethod;
      base.paymentDate = row.payment_date ?? base.paymentDate;
      base.paymentNotes = row.payment_notes ?? base.paymentNotes;
      base.notes = row.notes ?? base.notes;
      base.seriesId = row.series_id ?? base.seriesId;
      base.multiDayGroupId = row.multi_day_group_id ?? base.multiDayGroupId;
      base.discountId = row.discount_id ?? base.discountId;
      base.discountName = row.discount_name ?? base.discountName;
      base.discountAmount = row.discount_amount ?? base.discountAmount;
      base.kind = row.kind ?? base.kind ?? "appointment";
      base.serviceId = row.service_id ?? base.serviceId;
      base.source = row.source ?? base.source ?? null;
      base.referralSource = row.referral_source ?? base.referralSource ?? null;
      base.timezone = row.timezone ?? base.timezone ?? null;
      base.locale = row.locale ?? base.locale ?? null;
      base.createdFromPublic = row.created_from_public ?? base.createdFromPublic ?? false;
      base.isAllDay = row.is_all_day ?? base.isAllDay ?? false;
      base.blocksAvailability = row.blocks_availability ?? base.blocksAvailability ?? true;
      // Secure token for the public /pay/balance link (DB-only column,
      // minted by trigger; never lives in the data blob).
      base.balanceAccessToken = row.balance_access_token ?? base.balanceAccessToken ?? null;
      break;
    case "quotes":
      base.label = row.label ?? base.label;
      base.style = row.style ?? base.style;
      base.clientId = row.client_id ?? base.clientId;
      base.totalPrice = row.total_price ?? base.totalPrice;
      base.finalPrice = row.final_price ?? base.finalPrice;
      base.inputs = row.inputs ?? base.inputs;
      base.breakdown = row.breakdown ?? base.breakdown;
      base.savedAt = row.saved_at ?? base.savedAt;
      base.discountId = row.discount_id ?? base.discountId;
      base.discountName = row.discount_name ?? base.discountName;
      base.discountAmount = row.discount_amount ?? base.discountAmount;
      break;
    case "receipts":
      base.receiptNumber = row.receipt_number ?? base.receiptNumber;
      base.appointmentId = row.appointment_id ?? base.appointmentId;
      base.clientId = row.client_id ?? base.clientId;
      base.clientName = row.client_name ?? base.clientName;
      base.amountCollected = row.amount_collected ?? base.amountCollected;
      base.paymentStatus = row.payment_status ?? base.paymentStatus;
      base.paymentMethod = row.payment_method ?? base.paymentMethod;
      base.notes = row.notes ?? base.notes;
      break;
    case "communications":
      base.type = row.template_key ?? base.type;
      base.action = row.action ?? base.action;
      base.clientId = row.client_id ?? base.clientId;
      base.appointmentId = row.appointment_id ?? base.appointmentId;
      base.body = row.body ?? base.body;
      break;
    case "notifications":
      base.category = row.category ?? base.category;
      base.title = row.title ?? base.title;
      base.body = row.body ?? base.body;
      base.dismissed = row.dismissed ?? base.dismissed;
      base.readAt = row.read_at ?? base.readAt;
      break;
    case "photos":
      base.clientId = row.client_id ?? base.clientId;
      base.appointmentId = row.appointment_id ?? base.appointmentId;
      base.category = row.category ?? base.category;
      base.caption = row.caption ?? base.caption;
      base.takenAt = row.taken_at ?? base.takenAt;
      base.isFavorite = row.is_favorite ?? base.isFavorite;
      base.storagePath = row.storage_path ?? base.storagePath;
      base.thumbnailPath = row.thumbnail_path ?? base.thumbnailPath;
      break;
    case "business_expenses":
      base.title = row.title ?? base.title;
      base.amount = row.amount ?? base.amount;
      base.category = row.category ?? base.category;
      base.note = row.note ?? base.note;
      base.expenseDate = row.expense_date ?? base.expenseDate;
      base.isRecurring = row.is_recurring ?? base.isRecurring ?? false;
      base.recurringInterval = row.recurring_interval ?? base.recurringInterval;
      base.nextBillingDate = row.next_billing_date ?? base.nextBillingDate;
      base.receiptPath = row.receipt_path ?? base.receiptPath;
      break;
    case "inventory_items":
      base.name = row.name ?? base.name;
      base.sku = row.sku ?? base.sku;
      base.category = row.category ?? base.category;
      base.unit = row.unit ?? base.unit;
      base.unitCost = row.unit_cost ?? base.unitCost;
      base.retailPrice = row.retail_price ?? base.retailPrice;
      base.quantityOnHand = row.quantity_on_hand ?? base.quantityOnHand;
      base.lowStockThreshold = row.low_stock_threshold ?? base.lowStockThreshold;
      base.supplier = row.supplier ?? base.supplier;
      base.photoPath = row.photo_path ?? base.photoPath;
      base.storefrontProductId = row.storefront_product_id ?? base.storefrontProductId;
      base.itemType = row.item_type ?? base.itemType;
      base.archivedAt = row.archived_at ?? base.archivedAt;
      break;
    case "payment_transactions":
      base.appointmentId = row.appointment_id ?? base.appointmentId;
      base.clientId = row.client_id ?? base.clientId;
      base.clientName = row.client_name ?? base.clientName;
      base.serviceName = row.service_name ?? base.serviceName;
      base.amount = row.amount ?? base.amount;
      base.tipAmount = row.tip_amount ?? base.tipAmount;
      base.paymentType = row.payment_type ?? base.paymentType;
      base.paymentMethod = row.payment_method ?? base.paymentMethod;
      base.paidAt = row.paid_at ?? base.paidAt;
      base.note = row.note ?? base.note;
      break;
    case "inventory_movements":
      base.itemId = row.item_id ?? base.itemId;
      base.delta = row.delta ?? base.delta;
      base.reason = row.reason ?? base.reason;
      base.appointmentId = row.appointment_id ?? base.appointmentId;
      base.storefrontOrderId = row.storefront_order_id ?? base.storefrontOrderId;
      base.businessExpenseId = row.business_expense_id ?? base.businessExpenseId;
      base.unitCostSnapshot = row.unit_cost_snapshot ?? base.unitCostSnapshot;
      base.note = row.note ?? base.note;
      break;
  }
  return base;
};

// ---- Per-entity sync helpers -------------------------------------------
const upsertOne = async (table: SyncTable, userId: string, record: any) => {
  const supabase = getSupabase();
  const row = toCloudRow(table, userId, record);
  const { error } = await supabase.from(table).upsert(row, { onConflict: "user_id,id" });
  if (error) throw error;
};

const deleteOne = async (table: SyncTable, userId: string, id: string) => {
  const supabase = getSupabase();
  const { error } = await supabase.from(table).delete().eq("user_id", userId).eq("id", id);
  if (error) throw error;
};

const pullAll = async (table: SyncTable, userId: string): Promise<any[]> => {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(row => fromCloudRow(table, row));
};

export const syncClients = {
  upsert: (userId: string, record: any) => upsertOne("clients", userId, record),
  delete: (userId: string, id: string) => deleteOne("clients", userId, id),
  pull: (userId: string) => pullAll("clients", userId),
};

export const syncAppointments = {
  upsert: (userId: string, record: any) => upsertOne("appointments", userId, record),
  delete: (userId: string, id: string) => deleteOne("appointments", userId, id),
  pull: (userId: string) => pullAll("appointments", userId),
};

export const syncQuotes = {
  upsert: (userId: string, record: any) => upsertOne("quotes", userId, record),
  delete: (userId: string, id: string) => deleteOne("quotes", userId, id),
  pull: (userId: string) => pullAll("quotes", userId),
};

export const syncReceipts = {
  upsert: (userId: string, record: any) => upsertOne("receipts", userId, record),
  delete: (userId: string, id: string) => deleteOne("receipts", userId, id),
  pull: (userId: string) => pullAll("receipts", userId),
};

export const syncCommunications = {
  upsert: (userId: string, record: any) => upsertOne("communications", userId, record),
  delete: (userId: string, id: string) => deleteOne("communications", userId, id),
  pull: (userId: string) => pullAll("communications", userId),
};

export const syncNotifications = {
  upsert: (userId: string, record: any) => upsertOne("notifications", userId, record),
  delete: (userId: string, id: string) => deleteOne("notifications", userId, id),
  pull: (userId: string) => pullAll("notifications", userId),
};

export const syncPhotos = {
  upsert: (userId: string, record: any) => upsertOne("photos", userId, record),
  delete: (userId: string, id: string) => deleteOne("photos", userId, id),
  pull: (userId: string) => pullAll("photos", userId),
};

export const syncBusinessExpenses = {
  upsert: (userId: string, record: any) => upsertOne("business_expenses", userId, record),
  delete: (userId: string, id: string) => deleteOne("business_expenses", userId, id),
  pull: (userId: string) => pullAll("business_expenses", userId),
};

export const syncInventoryItems = {
  upsert: (userId: string, record: any) => upsertOne("inventory_items", userId, record),
  delete: (userId: string, id: string) => deleteOne("inventory_items", userId, id),
  pull: (userId: string) => pullAll("inventory_items", userId),
};

export const syncPaymentTransactions = {
  upsert: (userId: string, record: any) => upsertOne("payment_transactions", userId, record),
  delete: (userId: string, id: string) => deleteOne("payment_transactions", userId, id),
  pull: (userId: string) => pullAll("payment_transactions", userId),
};

// Movements are append-only — there's no delete and the only writes
// happen via the inventory_apply_movement RPC. We still expose pull
// so the local store can render the ledger.
export const syncInventoryMovements = {
  pull: (userId: string) => pullAll("inventory_movements", userId),
};

// ---- Settings (singleton row per user) ---------------------------------
export const syncSettings = {
  pull: async (userId: string) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },
  upsert: async (userId: string, business: any, reminderSettings: any) => {
    const supabase = getSupabase();
    const row = {
      user_id: userId,
      business_name: business?.businessName ?? null,
      currency: business?.currency || "USD",
      reminder_settings: reminderSettings ?? {},
      data: { business: business ?? null },
    };
    const { error } = await supabase.from("settings").upsert(row, { onConflict: "user_id" });
    if (error) throw error;
  },
};

// ---- Offline write queue -----------------------------------------------
// When a write fails (offline / 500), we serialise the intent to
// localStorage and drain it when sync resumes.
const QUEUE_KEY = "bbp-pending-syncs";

export type QueuedOp =
  | { kind: "upsert"; table: SyncTable; record: any }
  | { kind: "delete"; table: SyncTable; id: string }
  | { kind: "settings"; business: any; reminderSettings: any };

const readQueue = (): QueuedOp[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const writeQueue = (q: QueuedOp[]) => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* quota */ }
};

export const enqueueOp = (op: QueuedOp) => {
  const q = readQueue();
  q.push(op);
  writeQueue(q);
};

export const drainQueue = async (userId: string): Promise<{ ok: number; failed: number }> => {
  const q = readQueue();
  if (q.length === 0) return { ok: 0, failed: 0 };
  const remaining: QueuedOp[] = [];
  let ok = 0;
  let failed = 0;
  for (const op of q) {
    try {
      if (op.kind === "upsert") await upsertOne(op.table, userId, op.record);
      else if (op.kind === "delete") await deleteOne(op.table, userId, op.id);
      else if (op.kind === "settings") await syncSettings.upsert(userId, op.business, op.reminderSettings);
      ok += 1;
    } catch {
      remaining.push(op);
      failed += 1;
    }
  }
  writeQueue(remaining);
  return { ok, failed };
};

export const queueLength = () => readQueue().length;

export const tryUpsert = async (table: SyncTable, userId: string, record: any) => {
  try { await upsertOne(table, userId, record); }
  catch { enqueueOp({ kind: "upsert", table, record }); }
};
export const tryDelete = async (table: SyncTable, userId: string, id: string) => {
  try { await deleteOne(table, userId, id); }
  catch { enqueueOp({ kind: "delete", table, id }); }
};
export const trySaveSettings = async (userId: string, business: any, reminderSettings: any) => {
  try { await syncSettings.upsert(userId, business, reminderSettings); }
  catch { enqueueOp({ kind: "settings", business, reminderSettings }); }
};
