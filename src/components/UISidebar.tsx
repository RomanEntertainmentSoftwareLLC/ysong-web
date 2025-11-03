import React from "react";

export type Chat = {
    id: string;
    title: string;
    messages: { role: "user" | "assistant"; text: string }[];
};

type Props = {
    chats: Chat[];
    activeId: string;
    setActiveId: (id: string) => void;
    newChat: () => void;
    meEmail?: string | null;
    onLogout: () => void;
};

export default function Sidebar({
    chats,
    activeId,
    setActiveId,
    newChat,
    meEmail,
    onLogout,
}: Props) {
    return (
        // Fixed width; only this column can scroll if it overflows
        <aside className="w-[20rem] flex-shrink-0 border-r border-neutral-200 dark:border-neutral-800">
            <div className="h-[calc(100vh-4rem)] overflow-y-auto p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold">Chats</h2>
                    <button
                        onClick={newChat}
                        className="text-sm px-2 py-1 rounded-lg border"
                    >
                        New
                    </button>
                </div>

                {/* Chat list */}
                <div className="space-y-1">
                    {chats.map((c) => (
                        <button
                            key={c.id}
                            onClick={() => setActiveId(c.id)}
                            className={`w-full text-left px-3 py-2 rounded-lg border ${
                                c.id === activeId
                                    ? "bg-neutral-100 dark:bg-neutral-900"
                                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                            }`}
                            title={c.title}
                        >
                            {/* Title line (truncate); drop the literal word “Welcome” */}
                            <div className="truncate">
                                {c.title.replace(/^Welcome\s*/i, "") ||
                                    "Untitled"}
                            </div>
                            <div className="text-xs opacity-70 truncate">
                                {c.messages[c.messages.length - 1]?.text ||
                                    "No messages yet"}
                            </div>
                        </button>
                    ))}
                </div>

                <div className="mt-6 text-xs opacity-80">
                    <div className="truncate">Signed in as</div>
                    <div className="truncate font-medium">{meEmail || "…"}</div>
                    <button
                        onClick={onLogout}
                        className="mt-2 text-rose-600 hover:underline"
                    >
                        Sign out
                    </button>
                </div>
            </div>
        </aside>
    );
}
