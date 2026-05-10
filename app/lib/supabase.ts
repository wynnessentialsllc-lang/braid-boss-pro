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
  | "photos";

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
    discount_id: r => cleanString(r.discountId),
    discount_name: r => cleanString(r.discountName),
    discount_amount: r => (r.discountAmount == null ? null : cleanNumber(r.discountAmount)),
    kind: r => cleanString(r.kind) || "appointment",
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
      base.name = base.name ?? row.name;
      base.phone = base.phone ?? row.phone;
      base.email = base.email ?? row.email;
      base.preferredStyles = base.preferredStyles ?? row.preferred_styles ?? [];
      base.scalpSensitivity = base.scalpSensitivity ?? row.scalp_sensitivity;
      base.allergies = base.allergies ?? row.allergies;
      base.notes = base.notes ?? row.notes;
      break;
    case "appointments":
      base.clientId = base.clientId ?? row.client_id;
      base.clientName = base.clientName ?? row.client_name;
      base.clientPhone = base.clientPhone ?? row.client_phone;
      base.clientEmail = base.clientEmail ?? row.client_email;
      base.style = base.style ?? row.style;
      base.date = base.date ?? row.appt_date;
      base.time = base.time ?? row.appt_time;
      base.durationHours = base.durationHours ?? row.duration_hours;
      base.totalPrice = base.totalPrice ?? row.total_price;
      base.depositPaid = base.depositPaid ?? row.deposit_paid;
      base.balanceDue = base.balanceDue ?? row.balance_due;
      base.status = base.status ?? row.status;
      base.paymentStatus = base.paymentStatus ?? row.payment_status;
      base.paymentMethod = base.paymentMethod ?? row.payment_method;
      base.paymentDate = base.paymentDate ?? row.payment_date;
      base.paymentNotes = base.paymentNotes ?? row.payment_notes;
      base.notes = base.notes ?? row.notes;
      base.seriesId = base.seriesId ?? row.series_id;
      base.discountId = base.discountId ?? row.discount_id;
      base.discountName = base.discountName ?? row.discount_name;
      base.discountAmount = base.discountAmount ?? row.discount_amount;
      base.kind = base.kind ?? row.kind ?? "appointment";
      break;
    case "quotes":
      base.label = base.label ?? row.label;
      base.style = base.style ?? row.style;
      base.clientId = base.clientId ?? row.client_id;
      base.totalPrice = base.totalPrice ?? row.total_price;
      base.finalPrice = base.finalPrice ?? row.final_price;
      base.inputs = base.inputs ?? row.inputs;
      base.breakdown = base.breakdown ?? row.breakdown;
      base.savedAt = base.savedAt ?? row.saved_at;
      base.discountId = base.discountId ?? row.discount_id;
      base.discountName = base.discountName ?? row.discount_name;
      base.discountAmount = base.discountAmount ?? row.discount_amount;
      break;
    case "receipts":
      base.receiptNumber = base.receiptNumber ?? row.receipt_number;
      base.appointmentId = base.appointmentId ?? row.appointment_id;
      base.clientId = base.clientId ?? row.client_id;
      base.clientName = base.clientName ?? row.client_name;
      base.amountCollected = base.amountCollected ?? row.amount_collected;
      base.paymentStatus = base.paymentStatus ?? row.payment_status;
      base.paymentMethod = base.paymentMethod ?? row.payment_method;
      base.notes = base.notes ?? row.notes;
      break;
    case "communications":
      base.type = base.type ?? row.template_key;
      base.action = base.action ?? row.action;
      base.clientId = base.clientId ?? row.client_id;
      base.appointmentId = base.appointmentId ?? row.appointment_id;
      base.body = base.body ?? row.body;
      break;
    case "notifications":
      base.category = base.category ?? row.category;
      base.title = base.title ?? row.title;
      base.body = base.body ?? row.body;
      base.dismissed = base.dismissed ?? row.dismissed;
      base.readAt = base.readAt ?? row.read_at;
      break;
    case "photos":
      base.clientId = base.clientId ?? row.client_id;
      base.appointmentId = base.appointmentId ?? row.appointment_id;
      base.category = base.category ?? row.category;
      base.caption = base.caption ?? row.caption;
      base.takenAt = base.takenAt ?? row.taken_at;
      base.isFavorite = base.isFavorite ?? row.is_favorite;
      base.storagePath = base.storagePath ?? row.storage_path;
      base.thumbnailPath = base.thumbnailPath ?? row.thumbnail_path;
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
