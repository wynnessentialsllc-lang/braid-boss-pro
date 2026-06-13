"use client";

// Multi-item retail cart for the storefront.
//
// One cart per stylist handle — switching handles starts a new cart
// so two stylists' inventories never get mixed in a single checkout.
// Cart state is persisted in localStorage so it survives page
// refreshes and tab restarts; we hydrate on mount and write on
// every change.
//
// Items are keyed by (product_id, variant_id?) so the same product
// with two different variant picks shows up as two cart rows.
// Quantity increments collapse onto an existing row.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CartItem = {
  product_id: string;
  product_slug: string;
  title: string;
  image_url: string | null;
  unit_amount: number;        // dollars, not cents
  quantity: number;
  inventory_count: number | null;
  variant_id: string | null;
  variant_label: string | null;
  variant_name: string | null;
  requires_shipping: boolean;
};

export type CartState = {
  handle: string | null;       // Stylist handle the cart is scoped to.
  items: CartItem[];
};

const STORAGE_KEY = "bbp-cart-v1";
// sessionStorage key for the drawer's open state. We use sessionStorage,
// not localStorage, so a closed-and-reopened tab starts cleanly; but a
// same-tab refresh (which a buyer might do mid-purchase) keeps the drawer
// open — including their shipping-rate picker state — so they don't lose
// progress.
const OPEN_STATE_KEY = "bbp-cart-open-v1";

const emptyCart: CartState = { handle: null, items: [] };

const readStorage = (): CartState => {
  if (typeof window === "undefined") return emptyCart;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCart;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyCart;
    return {
      handle: typeof parsed.handle === "string" ? parsed.handle : null,
      items: Array.isArray(parsed.items)
        ? parsed.items
            .map((i: any) => ({
              product_id: String(i?.product_id || ""),
              product_slug: String(i?.product_slug || ""),
              title: String(i?.title || ""),
              image_url: i?.image_url ?? null,
              unit_amount: Number.isFinite(Number(i?.unit_amount)) ? Number(i.unit_amount) : 0,
              quantity: Math.max(1, Math.min(99, Math.floor(Number(i?.quantity) || 1))),
              inventory_count: i?.inventory_count == null ? null : Number(i.inventory_count),
              variant_id: i?.variant_id ? String(i.variant_id) : null,
              variant_label: i?.variant_label ? String(i.variant_label) : null,
              variant_name: i?.variant_name ? String(i.variant_name) : null,
              requires_shipping: !!i?.requires_shipping,
            }))
            .filter((i: CartItem) => i.product_id && i.product_slug)
        : [],
    };
  } catch {
    return emptyCart;
  }
};

const writeStorage = (state: CartState) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode — non-fatal */
  }
};

// (product_id, variant_id) tuple key — variantless products collapse
// into one row regardless; variant rows stay distinct per variant.
const itemKey = (i: { product_id: string; variant_id: string | null }) =>
  `${i.product_id}::${i.variant_id || ""}`;

type AddItemInput = Omit<CartItem, "quantity"> & { quantity?: number };

type CartContextValue = {
  cart: CartState;
  totalQuantity: number;
  subtotal: number;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  // Optional `handle` scopes the cart to a single stylist. When the
  // user adds an item belonging to a different handle than the
  // current cart's, the cart is reset to that new stylist (preventing
  // cross-stylist line items in one checkout).
  addItem: (item: AddItemInput, handle?: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  keyOf: typeof itemKey;
};

const CartContext = createContext<CartContextValue | null>(null);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  // Hydrate from localStorage post-mount to keep SSR + first paint
  // deterministic (the cart is anonymous so there's nothing to render
  // until the client takes over).
  const [cart, setCart] = useState<CartState>(emptyCart);
  const [hydrated, setHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setCart(readStorage());
    // Restore drawer-open state from the same-tab session so a mid-flow
    // refresh keeps the buyer on the cart / rate-picker screen.
    try {
      if (typeof window !== "undefined" && window.sessionStorage.getItem(OPEN_STATE_KEY) === "1") {
        setIsOpen(true);
      }
    } catch { /* private mode — non-fatal */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(cart);
  }, [cart, hydrated]);

  const addItem = useCallback((item: AddItemInput, handle?: string) => {
    setCart((prev) => {
      const desiredQty = Math.max(1, Math.min(99, Math.floor(item.quantity ?? 1)));
      // Cross-stylist guard: when the new item belongs to a different
      // stylist than the cart's current scope, wipe the cart first so
      // the checkout never sends mixed line items to a single Stripe
      // Connect account.
      const incomingHandle = handle?.trim() || null;
      const sameStylist = !prev.handle || !incomingHandle || prev.handle === incomingHandle;
      const baseItems = sameStylist ? prev.items : [];
      const cartItem: CartItem = {
        product_id: item.product_id,
        product_slug: item.product_slug,
        title: item.title,
        image_url: item.image_url,
        unit_amount: item.unit_amount,
        quantity: desiredQty,
        inventory_count: item.inventory_count,
        variant_id: item.variant_id,
        variant_label: item.variant_label,
        variant_name: item.variant_name,
        requires_shipping: item.requires_shipping,
      };
      const k = itemKey(cartItem);
      const existing = baseItems.find((i) => itemKey(i) === k);
      const items = existing
        ? baseItems.map((i) =>
            itemKey(i) === k
              ? { ...i, quantity: clampToInventory(i.quantity + desiredQty, i.inventory_count) }
              : i,
          )
        : [...baseItems, cartItem];
      return { handle: incomingHandle || prev.handle || null, items };
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setCart((prev) => ({
      ...prev,
      items: prev.items
        .map((i) =>
          itemKey(i) === key
            ? { ...i, quantity: clampToInventory(Math.floor(quantity), i.inventory_count) }
            : i,
        )
        .filter((i) => i.quantity > 0),
    }));
  }, []);

  const removeItem = useCallback((key: string) => {
    setCart((prev) => ({
      ...prev,
      items: prev.items.filter((i) => itemKey(i) !== key),
    }));
  }, []);

  const clear = useCallback(() => setCart(emptyCart), []);

  const totalQuantity = useMemo(
    () => cart.items.reduce((s, i) => s + i.quantity, 0),
    [cart.items],
  );
  const subtotal = useMemo(
    () => cart.items.reduce((s, i) => s + i.quantity * i.unit_amount, 0),
    [cart.items],
  );

  const value: CartContextValue = {
    cart,
    totalQuantity,
    subtotal,
    isOpen,
    openCart: () => {
      setIsOpen(true);
      try { window.sessionStorage.setItem(OPEN_STATE_KEY, "1"); } catch {}
    },
    closeCart: () => {
      setIsOpen(false);
      try { window.sessionStorage.removeItem(OPEN_STATE_KEY); } catch {}
    },
    addItem,
    setQuantity,
    removeItem,
    clear,
    keyOf: itemKey,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

// Clamp the quantity to the product's inventory ceiling (when set).
// null inventory = untracked = no cap.
const clampToInventory = (q: number, inv: number | null): number => {
  const lo = 1;
  if (inv == null) return Math.max(lo, Math.min(99, q));
  return Math.max(lo, Math.min(99, Math.min(inv, q)));
};

export const useCart = (): CartContextValue => {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart() called outside a <CartProvider>. Mount the provider in app/layout.tsx.");
  }
  return ctx;
};

// Server-side bind: which stylist owns this cart? Pages call this
// after the user navigates to /@handle/... so the cart picks up the
// scope. If a handle change happens, the existing items belong to
// the prior stylist and stay associated with their handle — but the
// cart's `handle` field is updated so subsequent adds will check.
export const useBindCartHandle = (handle: string | null) => {
  const { cart } = useCart();
  useEffect(() => {
    if (!handle) return;
    if (cart.handle === handle) return;
    // We can't mutate state directly here because the provider doesn't
    // expose a setter; instead the cart's first add() call will set it.
    // Reading the existing handle is enough to detect a mismatch
    // upstream if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, cart.handle]);
};
