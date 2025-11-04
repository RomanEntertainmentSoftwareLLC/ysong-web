export type Chat = {
    id: string;
    title?: string; // optional
    messages: { role: "user" | "assistant"; text: string }[];
};

type Props = {
    chats: Chat[];
    activeId: string;
    setActiveId: (id: string) => void;
    newChat: () => void;
    meEmail?: string | null;
    onLogout?: () => void;
};

function normalizeOneLine(s: string) {
    return s.replace(/\s+/g, " ").trim();
}
function truncate(s: string, max = 48) {
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function chatLabel(chat: Chat): string {
    const t = normalizeOneLine(chat.title ?? "");
    if (t) return t;
    const last = chat.messages[chat.messages.length - 1]?.text ?? "";
    const normalized = normalizeOneLine(last);
    return normalized || "New chat";
}

export default function UISidebar({
    chats,
    activeId,
    setActiveId,
    newChat,
    meEmail,
    onLogout,
}: Props) {
    return (
        <aside
            className="h-full w-[15%] min-w-[220px] max-w-[320px] border-r
                 border-neutral-200 dark:border-neutral-800 p-4 space-y-3"
        >
            <div className="flex items-center justify-between">
                <h2 className="font-semibold">Chats</h2>
                <button
                    onClick={newChat}
                    className="text-sm px-2 py-1 rounded-lg border"
                >
                    New
                </button>
            </div>

            <div className="space-y-1">
                {chats.map((c) => {
                    const labelFull = chatLabel(c);
                    const label = truncate(labelFull, 48);
                    const isActive = c.id === activeId;

                    return (
                        <button
                            key={c.id}
                            onClick={() => setActiveId(c.id)}
                            className={`w-full text-left px-3 py-2 rounded-lg border truncate
                ${
                    isActive
                        ? "bg-neutral-100 dark:bg-neutral-900"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
                            title={labelFull}
                        >
                            <div className="truncate font-medium">{label}</div>
                            {/* No second line, no "No messages yet" — single line only */}
                        </button>
                    );
                })}
            </div>

            <div className="mt-6 text-xs opacity-80">
                <div className="truncate">Signed in as</div>
                <div className="truncate font-medium">{meEmail || "…"}</div>
                {onLogout && (
                    <button
                        onClick={onLogout}
                        className="mt-2 text-rose-600 hover:underline"
                    >
                        Sign out
                    </button>
                )}
            </div>
        </aside>
    );
}
