import { apiGet, apiPost } from "./authApi";

export type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	attachments?: any;
	createdAt: string;
};

export async function fetchChatMessages(chatId: string): Promise<ChatMessage[]> {
	const res = await apiGet<{ messages: ChatMessage[] }>(`/api/chats/${chatId}/messages`);
	return res.messages;
}

export async function appendMessage(
	chatId: string,
	msg: { role: "user" | "assistant"; content: string; attachments?: any }
): Promise<ChatMessage> {
	return apiPost<ChatMessage>(`/api/chats/${chatId}/messages`, msg);
}
