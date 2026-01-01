import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { YSButton } from "./YSButton";

export type Chat = {
    id: string;
    title?: string;
    messages?: {
        role: "user" | "assistant";
        text: string;
        ts?: number;
        attachments?: any;
    }[];
};

type ModuleType =
    | "settings"
    | "daw"
    | "mixer"
    | "band"
    | "artwork"
    | "library"
    | "market"
    | "world";

type Props = {
    chats: Chat[];
    activeId: string;
    setActiveId: (id: string) => void;
    newChat: () => void;
    meEmail?: string | null;
    onLogout?: () => void;

    // Optional callbacks supplied by parent (UI.tsx)
    onOpenModule?: (type: ModuleType) => void;
    onOpenChatTab?: (chat: Chat) => void;

    // Edit actions
    onRenameChat?: (chatId: string, newTitle: string) => void;
    onDeleteChat?: (chatId: string) => void;
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
    return "New chat";
}

/* simple menu item */
function MenuItem({
    children,
    onClick,
    danger,
}: {
    children: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
}) {
    return (
        <YSButton
            className={`w-full flex items-center px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                danger ? "text-red-600 dark:text-red-400" : ""
            }`}
            onClick={onClick}
        >
            {children}
        </YSButton>
    );
}

export default function UISidebar({
    chats,
    activeId,
    setActiveId,
    newChat,
    meEmail,
    onLogout,
    onOpenModule,
    onOpenChatTab,
    onRenameChat,
    onDeleteChat,
}: Props) {
    // Floating menu state (portal)
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({
        top: 0,
        left: 0,
    });
    const anchorElRef = useRef<HTMLElement | null>(null);

    const GAP_BETWEEN_BUTTONS = 4;
    const NUMBER_OF_CHAT_INSTANCES_VISIBLE = 3;
    const CHAT_INSTANCE_BUTTON_HEIGHT = 44;

    const maxHeight =
        NUMBER_OF_CHAT_INSTANCES_VISIBLE * CHAT_INSTANCE_BUTTON_HEIGHT +
        (NUMBER_OF_CHAT_INSTANCES_VISIBLE - 1) * GAP_BETWEEN_BUTTONS;

    function positionMenu(el: HTMLElement) {
        const rect = el.getBoundingClientRect();
        const MENU_W = 176; // approx width of the menu
        const GAP = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // default: dropdown, right-aligned
        let left = rect.right - MENU_W;
        let top = rect.bottom + GAP;

        // keep inside viewport
        if (left < 8) left = 8;
        if (left + MENU_W > vw - 8) left = vw - MENU_W - 8;

        // flip up if not enough room below
        const roomBelow = vh - rect.bottom - GAP;
        const estMenuH = 160;
        if (roomBelow < estMenuH) top = rect.top - GAP - estMenuH;

        setMenuPos({ top, left });
    }

    // Reposition on resize/scroll; close on Escape
    useEffect(() => {
        const onResize = () => {
            if (anchorElRef.current) positionMenu(anchorElRef.current);
        };
        const onScroll = () => {
            if (anchorElRef.current) positionMenu(anchorElRef.current);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMenuFor(null);
        };
        window.addEventListener("resize", onResize);
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    return (
        <aside className="h-full w-full p-4 space-y-3 flex flex-col min-h-0">
            {/* Header: account box (sticky) */}
            <div
                className="
          sticky top-0 z-10
          mt-0 lg:-mt-4
          pl-4 pr-12 lg:pr-4
          pt-[max(1rem,env(safe-area-inset-top))] pb-3
          bg-white/90 dark:bg-neutral-950/90 backdrop-blur
          border-b border-neutral-200 dark:border-neutral-800
          lg:rounded-t-lg
        "
            >
                <div className="text-[10px] uppercase tracking-wide opacity-60">
                    Signed in as
                </div>
                <div className="truncate font-medium" title={meEmail || ""}>
                    {meEmail || "…"}
                </div>
                <div className="mt-2 flex items-center gap-2">
                    {onLogout && (
                        <YSButton
                            onClick={onLogout}
                            className="ml-auto text-sm px-3 py-1.5 whitespace-nowrap rounded-lg border
                        border-neutral-300 dark:border-neutral-700
                        hover:bg-neutral-50 dark:hover:bg-neutral-900"
                            title="Sign out"
                        >
                            Sign out
                        </YSButton>
                    )}
                </div>
            </div>

            {/* Chats header row */}
            <div className="flex items-center justify-between mt-2">
                <h2 className="font-semibold">Chat</h2>
                <YSButton
                    onClick={newChat}
                    className="text-sm px-2 py-1 rounded-lg border
                     border-neutral-300 dark:border-neutral-700
                     hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    title="Start a new chat"
                >
                    New
                </YSButton>
            </div>

            {/* Chat listbox: up to 3 visible rows */}
            <div className="mt-2">
                <div className="overflow-y-auto pr-1" style={{ maxHeight }}>
                    <div className="space-y-1">
                        {chats.map((c) => {
                            const raw = chatLabel(c);
                            const primary = truncate(raw, 48);
                            const isActive = c.id === activeId;

                            return (
                                <div key={c.id} className="group relative">
                                    {/* main row button */}
                                    <YSButton
                                        onClick={() =>
                                            onOpenChatTab
                                                ? onOpenChatTab(c)
                                                : setActiveId(c.id)
                                        }
                                        className={`w-full text-left px-3 rounded-lg border h-11 flex items-center pr-10
                      ${
                          isActive
                              ? "bg-neutral-100 dark:bg-neutral-900"
                              : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                      }`}
                                        title={raw}
                                    >
                                        <div className="truncate">
                                            {primary}
                                        </div>
                                    </YSButton>

                                    {/* 3-dot trigger (no silhouette) */}
                                    <YSButton
                                        className={`absolute right-1 top-1/2 -translate-y-1/2
                                opacity-0 group-hover:opacity-100 transition-opacity
                                pointer-events-none group-hover:pointer-events-auto
                                h-7 w-7 grid place-items-center rounded-md
                                text-neutral-500 dark:text-neutral-400
                                appearance-none bg-transparent border-none outline-none ring-0 shadow-none p-0 m-0
                                ${
                                    menuFor === c.id
                                        ? "ring-1 ring-neutral-300 dark:ring-neutral-700 bg-white/80 dark:bg-neutral-900/80"
                                        : "hover:ring-1 hover:ring-neutral-300 dark:hover:ring-neutral-700"
                                }`}
                                        aria-label="Chat options"
                                        title="Chat options"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const el =
                                                e.currentTarget as HTMLElement;
                                            anchorElRef.current = el;
                                            positionMenu(el);
                                            setMenuFor((prev) =>
                                                prev === c.id ? null : c.id
                                            );
                                        }}
                                        style={
                                            {
                                                WebkitAppearance: "none",
                                                MozAppearance: "none",
                                            } as any
                                        }
                                    >
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                        >
                                            <circle cx="12" cy="5" r="2" />
                                            <circle cx="12" cy="12" r="2" />
                                            <circle cx="12" cy="19" r="2" />
                                        </svg>
                                    </YSButton>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Modules */}
            <div className="mt-6">
                <h2 className="font-semibold">Menu</h2>
                <div className="mt-2 space-y-2 max-h-[288px] overflow-y-auto pr-1">
                    {(
                        [
                            ["Chat", "chat"],
                            ["Settings", "settings"],
                            ["DAW", "daw"],
                            ["Mixer", "mixer"],
                            ["Band Creation", "band"],
                            ["Artwork Studio", "artwork"],
                            ["My Library", "library"],
                            ["Marketplace", "market"],
                            ["YSong World", "world"],
                        ] as [string, ModuleType][]
                    ).map(([label, type]) => (
                        <YSButton
                            key={type}
                            onClick={() => onOpenModule?.(type)}
                            className="w-full text-left px-3 py-2 rounded-lg border hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        >
                            {label}
                        </YSButton>
                    ))}
                </div>
            </div>

            {/* Floating context menu (portal) */}
            {menuFor &&
                createPortal(
                    <>
                        {/* backdrop to catch outside clicks */}
                        <div
                            className="fixed inset-0 z-[100] bg-transparent"
                            onClick={() => setMenuFor(null)}
                        />
                        <div
                            className="fixed z-[101]"
                            style={{
                                top: `${menuPos.top}px`,
                                left: `${menuPos.left}px`,
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div
                                className="w-44 rounded-xl border border-neutral-300 dark:border-neutral-700
                           bg-white dark:bg-neutral-900 shadow-xl p-1"
                            >
                                <MenuItem
                                    onClick={() => {
                                        const current = chats.find(
                                            (x) => x.id === menuFor
                                        );
                                        const name = window.prompt(
                                            "Rename chat",
                                            current
                                                ? chatLabel(current)
                                                : "Untitled"
                                        );
                                        if (name && name.trim())
                                            onRenameChat?.(
                                                menuFor,
                                                name.trim()
                                            );
                                        setMenuFor(null);
                                    }}
                                >
                                    {/* pencil icon */}
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="mr-2"
                                    >
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                    </svg>
                                    Rename
                                </MenuItem>

                                <MenuItem
                                    onClick={() => {
                                        if (
                                            window.confirm(
                                                "Delete this chat? This cannot be undone."
                                            )
                                        ) {
                                            onDeleteChat?.(menuFor);
                                        }
                                        setMenuFor(null);
                                    }}
                                    danger
                                >
                                    {/* trash icon */}
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="mr-2"
                                    >
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                        <path d="M10 11v6" />
                                        <path d="M14 11v6" />
                                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                    </svg>
                                    Delete
                                </MenuItem>
                            </div>
                        </div>
                    </>,
                    document.body
                )}
        </aside>
    );
}
