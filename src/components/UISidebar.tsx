import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";

export type Chat = {
  id: string;
  title?: string;
  personaId?: string;
  messages?: { role: "user" | "assistant"; text: string; ts?: number; attachments?: any; personaId?: string | null }[];
};

type ModuleType = "profile" | "settings" | "daw" | "mixer" | "createSong" | "band" | "singers" | "analytics" | "artwork" | "library" | "achievements" | "rooms" | "market" | "world" | "upload";

type Props = {
  chats: Chat[];
  activeId: string;
  setActiveId: (id: string) => void;
  newChat: () => void;
  meDisplayName?: string | null;
  meAvatarUrl?: string | null;
  onLogout?: () => void;
  onOpenModule?: (type: ModuleType) => void;
  onOpenChatTab?: (chat: Chat) => void;
  onRenameChat?: (chatId: string, newTitle: string) => void;
  onDeleteChat?: (chatId: string) => void;
};

function normalizeOneLine(s: string) { return s.replace(/\s+/g, " ").trim(); }
function truncate(s: string, max = 48) { return s.length > max ? s.slice(0, max - 1) + "…" : s; }
function chatLabel(chat: Chat) { return normalizeOneLine(chat.title ?? "") || "New chat"; }

const navItems: { label: string; type: ModuleType; icon: string }[] = [
  { label: "Rooms", type: "rooms", icon: "rooms" },
  { label: "DAW", type: "daw", icon: "wave" },
  { label: "Mixer", type: "mixer", icon: "sliders" },
  { label: "Create Song", type: "createSong", icon: "spark" },
  { label: "Band Creation", type: "band", icon: "users" },
  { label: "Singer Studio", type: "singers", icon: "mic" },
  { label: "Analytics", type: "analytics", icon: "chart" },
  { label: "Artwork Studio", type: "artwork", icon: "image" },
  { label: "My Library", type: "library", icon: "library" },
  { label: "Achievements", type: "achievements", icon: "trophy" },
  { label: "Marketplace", type: "market", icon: "store" },
  { label: "YSong World", type: "world", icon: "globe" },
  { label: "Upload Music", type: "upload", icon: "upload" },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    wave: <><path d="M3 12h2l2-6 3 12 3-9 2 6 2-3h4"/></>,
    sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/></>,
    spark: <><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5 5"/></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-4-4L5 20"/></>,
    library: <><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l3-1 3 14-3 1z"/></>,
    trophy: <><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 12v5M8 21h8M10 17h4"/></>,
    store: <><path d="M4 10v10h16V10M3 10l2-6h14l2 6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/></>,
    rooms: <><path d="M4 5h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9l-5 4v-4a3 3 0 0 1-2-3V8a3 3 0 0 1 2-3Z"/><path d="M7 9h8M7 13h5"/></>,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    dots: <><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/></>,
  };
  return <svg {...common} aria-hidden>{paths[name]}</svg>;
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button className={`w-full flex items-center px-3 py-2 rounded-lg text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${danger ? "text-red-500" : ""}`} onClick={onClick}>{children}</button>;
}

export default function UISidebar({ chats, activeId, setActiveId, newChat, meDisplayName, meAvatarUrl, onLogout, onOpenModule, onOpenChatTab, onRenameChat, onDeleteChat }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const anchorElRef = useRef<HTMLElement | null>(null);
  const maxHeight = 3 * 42 + 2 * 4;

  function positionMenu(el: HTMLElement) {
    const rect = el.getBoundingClientRect(); const width = 176; const gap = 8;
    let left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    let top = rect.bottom + gap;
    if (window.innerHeight - rect.bottom < 170) top = Math.max(8, rect.top - 168);
    setMenuPos({ top, left });
  }

  useEffect(() => {
    const reposition = () => anchorElRef.current && positionMenu(anchorElRef.current);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenuFor(null);
    window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); window.removeEventListener("keydown", key); };
  }, []);

  return <aside className="h-full min-h-0 flex flex-col bg-white/45 dark:bg-neutral-950/35">
    <div className="shrink-0 px-3 py-3 border-b border-neutral-200/70 dark:border-white/10">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onOpenModule?.("profile")} className="min-w-0 flex-1 flex items-center gap-3 rounded-xl px-1.5 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5 transition" title="Open profile">
          <Avatar src={meAvatarUrl} name={meDisplayName || "User"} size={40} />
          <div className="min-w-0"><div className="text-[9px] uppercase tracking-[.12em] opacity-50">Signed in as</div><div className="truncate text-sm font-semibold">{meDisplayName || "…"}</div></div>
        </button>
        <button type="button" onClick={() => onOpenModule?.("settings")} className="h-9 w-9 shrink-0 grid place-items-center rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-black/5 dark:hover:text-white dark:hover:bg-white/5" title="Settings" aria-label="Settings"><Icon name="gear" size={17}/></button>
        {onLogout && <button type="button" onClick={onLogout} className="h-9 w-9 shrink-0 grid place-items-center rounded-lg text-neutral-500 hover:text-red-500 hover:bg-red-500/10" title="Sign out" aria-label="Sign out"><Icon name="logout" size={18}/></button>}
      </div>
    </div>

    <div className="shrink-0 px-3 pt-4">
      <div className="flex items-center justify-between px-1 mb-2"><h2 className="text-xs font-semibold uppercase tracking-[.12em] text-neutral-500">Chat</h2><button onClick={newChat} className="h-7 w-7 grid place-items-center rounded-lg text-neutral-500 hover:bg-black/5 dark:hover:bg-white/5" title="New chat"><Icon name="plus" size={15}/></button></div>
      <div className="overflow-y-auto pr-1" style={{ maxHeight }}><div className="space-y-1">
        {chats.map((c) => {
          const raw = chatLabel(c); const isActive = c.id === activeId;
          return <div key={c.id} className="group relative">
            <button onClick={() => onOpenChatTab ? onOpenChatTab(c) : setActiveId(c.id)} className={`w-full h-10 flex items-center rounded-lg px-2.5 pr-9 text-left text-sm transition ${isActive ? "bg-neutral-200/80 dark:bg-white/10 text-neutral-950 dark:text-white" : "text-neutral-600 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/5"}`} title={raw}><span className="truncate">{truncate(raw, 48)}</span></button>
            <button className={`absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-md text-neutral-500 opacity-0 group-hover:opacity-100 ${menuFor === c.id ? "opacity-100 bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/10"}`} title="Chat options" aria-label="Chat options" onClick={(e) => { e.stopPropagation(); anchorElRef.current = e.currentTarget; positionMenu(e.currentTarget); setMenuFor((v) => v === c.id ? null : c.id); }}><Icon name="dots" size={15}/></button>
          </div>;
        })}
      </div></div>
    </div>

    <div className="flex-1 min-h-0 px-3 pt-5 pb-3 flex flex-col">
      <h2 className="px-1 mb-2 text-xs font-semibold uppercase tracking-[.12em] text-neutral-500">Workspace</h2>
      <nav className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-0.5">
        {navItems.map((item) => <button key={item.type} onClick={() => onOpenModule?.(item.type)} className="w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-black/5 hover:text-neutral-950 dark:hover:bg-white/6 dark:hover:text-white transition"><span className="w-5 grid place-items-center text-neutral-500"><Icon name={item.icon}/></span><span className="truncate">{item.label}</span></button>)}
      </nav>
    </div>

    {menuFor && createPortal(<><div className="fixed inset-0 z-[100]" onClick={() => setMenuFor(null)} /><div className="fixed z-[101] w-44 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-1" style={{ top: menuPos.top, left: menuPos.left }} onClick={(e) => e.stopPropagation()}>
      <MenuItem onClick={() => { const current = chats.find((x) => x.id === menuFor); const name = window.prompt("Rename chat", current ? chatLabel(current) : "Untitled"); if (name?.trim()) onRenameChat?.(menuFor, name.trim()); setMenuFor(null); }}>Rename</MenuItem>
      <MenuItem danger onClick={() => { if (window.confirm("Delete this chat? This cannot be undone.")) onDeleteChat?.(menuFor); setMenuFor(null); }}>Delete</MenuItem>
    </div></>, document.body)}
  </aside>;
}
