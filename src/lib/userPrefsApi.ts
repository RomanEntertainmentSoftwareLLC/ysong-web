import { apiGet, apiPost } from "./authApi";
import type { TabRecord } from "../tabs/core";

// ---------- Types ----------
export type UserSettingsResponse = {
	saveChats: boolean;
	theme: "light" | "dark";
	showTimestamps: boolean;
	compactMode: boolean;
};

// ---------- Settings ----------
export async function loadUserSettings() {
	return apiGet<UserSettingsResponse>("/api/settings");
}

export async function saveUserSettings(p: Partial<UserSettingsResponse>) {
	return apiPost("/api/settings", {
		// send ALL the fields the server expects
		saveChats: p.saveChats,
		theme: p.theme,
		showTimestamps: p.showTimestamps,
		compactMode: p.compactMode,
	});
}

// ---------- UI Layout ----------
export async function loadLayout() {
	// -> { tabs: TabRecord[], activeId: string | null }
	return apiGet<{ tabs: TabRecord[]; activeId: string | null }>("/api/ui/layout");
}

export async function saveLayout(p: { tabs: TabRecord[]; activeId: string | null }) {
	// server accepts POST upsert
	return apiPost("/api/ui/layout", p);
}
