const PIN_KEY = "together_pin_hash_v1";
const UNLOCK_KEY = "together_unlocked";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");
}

export function hasLocalPin() { return typeof window !== "undefined" && Boolean(localStorage.getItem(PIN_KEY)); }
export function isSessionUnlocked() { return typeof window !== "undefined" && sessionStorage.getItem(UNLOCK_KEY) === "1"; }
export function lockSession() { if (typeof window !== "undefined") sessionStorage.removeItem(UNLOCK_KEY); }
export function clearLocalPin() { if (typeof window !== "undefined") { localStorage.removeItem(PIN_KEY); sessionStorage.removeItem(UNLOCK_KEY); } }
export async function setLocalPin(pin: string) { if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4–8 digits"); localStorage.setItem(PIN_KEY, await sha256(pin)); sessionStorage.setItem(UNLOCK_KEY, "1"); }
export async function verifyLocalPin(pin: string) { const ok = localStorage.getItem(PIN_KEY) === await sha256(pin); if (ok) sessionStorage.setItem(UNLOCK_KEY, "1"); return ok; }
