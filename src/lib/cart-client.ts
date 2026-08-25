export type StoredCartItem = {
  productId: string;
  quantity: number;
};

const CART_KEY = "dealforge-cart-v1";
export const CART_CHANGED_EVENT = "dealforge:cart-changed";

function sanitize(items: unknown): StoredCartItem[] {
  if (!Array.isArray(items)) return [];
  const quantities = new Map<string, number>();
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { productId?: unknown; quantity?: unknown };
    if (typeof item.productId !== "string" || !item.productId.trim()) continue;
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity)) continue;
    const current = quantities.get(item.productId) ?? 0;
    quantities.set(item.productId, Math.min(25, Math.max(1, current + item.quantity)));
  }
  return [...quantities.entries()].slice(0, 20).map(([productId, quantity]) => ({ productId, quantity }));
}

export function readCart(): StoredCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    return sanitize(JSON.parse(window.localStorage.getItem(CART_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function writeCart(items: StoredCartItem[]) {
  if (typeof window === "undefined") return;
  const next = sanitize(items);
  window.localStorage.setItem(CART_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { count: cartCount(next) } }));
}

export function addCartItem(productId: string, quantity = 1) {
  const id = productId.trim();
  if (!id || !Number.isInteger(quantity) || quantity < 1) return readCart();
  const items = readCart();
  const current = items.find((item) => item.productId === id);
  if (current) current.quantity = Math.min(25, current.quantity + quantity);
  else if (items.length < 20) items.push({ productId: id, quantity: Math.min(25, quantity) });
  writeCart(items);
  return items;
}

export function updateCartQuantity(productId: string, quantity: number) {
  const items = readCart();
  if (!Number.isInteger(quantity) || quantity <= 0) {
    writeCart(items.filter((item) => item.productId !== productId));
    return;
  }
  writeCart(items.map((item) => item.productId === productId ? { ...item, quantity: Math.min(25, quantity) } : item));
}

export function removeCartItem(productId: string) {
  writeCart(readCart().filter((item) => item.productId !== productId));
}

export function clearCart() {
  writeCart([]);
}

export function cartCount(items = readCart()) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
