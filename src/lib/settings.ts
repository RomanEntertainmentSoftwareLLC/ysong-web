const KEY = "ysong.saveChatsToCloud";

export function getSaveChatsFlag(): boolean {
  return localStorage.getItem(KEY) === "1";
}
export function setSaveChatsFlag(v: boolean) {
  localStorage.setItem(KEY, v ? "1" : "0");
}
