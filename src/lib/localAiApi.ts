import { apiPost } from "./authApi";
import { DEFAULT_PERSONA_ID } from "./personaApi";

export type LocalAiMessage = { role: "system" | "user" | "assistant"; content: string };

// Studio AI uses the same authenticated backend persona/rules pipeline as main chat.
// Universal + Surfer Dude are resolved from Neon on the server. Callers only add
// their task-specific developer/system instructions here.
export async function localAiChat(messages: LocalAiMessage[], personaId = DEFAULT_PERSONA_ID): Promise<string> {
  const data = await apiPost<{ reply?: string }>("/chat", { personaId, messages });
  return String(data?.reply || "");
}
