import { apiGet, apiPost } from "./authApi";
import type { TabRecord } from "../tabs/core";

// ---------- Settings ----------
export async function fetchUserSettings() {
  // -> { saveChats:boolean, theme:'light'|'dark'|'system' }
  return apiGet<{ saveChats: boolean; theme: "light" | "dark" | "system" }>(
    "/api/settings"
  );
}

export async function updateUserSettings(p: Partial<{ saveChats: boolean; theme: "light" | "dark" | "system" }>) {
  // server accepts POST upsert
  return apiPost("/api/settings", p);
}

// ---------- UI Layout ----------
export async function fetchLayout() {
  // -> { tabs: TabRecord[], activeId: string | null }
  return apiGet<{ tabs: TabRecord[]; activeId: string | null }>("/api/ui/layout");
}

export async function saveLayout(p: { tabs: TabRecord[]; activeId: string | null }) {
  // server accepts POST upsert
  return apiPost("/api/ui/layout", p);
}