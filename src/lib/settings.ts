const KEY = "ysong.saveChatsToCloud";

export function getSaveChatsFlag() {
  return typeof window !== "undefined" && localStorage.getItem(KEY) === "1";
}
export function setSaveChatsFlag(v: boolean) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, v ? "1" : "0");
}
export function ensureSaveChatsDefault(v = false) {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(KEY) == null) setSaveChatsFlag(v);
}
export const SAVE_CHATS_KEY = "ysong.saveChatsToCloud";