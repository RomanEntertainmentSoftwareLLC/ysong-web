import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { EMOJI_DATA, type EmojiEntry } from "../lib/emojiData";

type EmojiPickerButtonProps = {
	inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
	value: string;
	onChange: (value: string) => void;
	buttonClassName?: string;
};

type PickerPosition = { left: number; top?: number; bottom?: number; width: number; maxHeight: number };

const CATEGORY_META: Array<{ key: string; label: string; icon: string }> = [
	{ key: "recent", label: "Recent", icon: "🕘" },
	{ key: "Smileys & Emotion", label: "Smileys", icon: "😀" },
	{ key: "People & Body", label: "People", icon: "🧑" },
	{ key: "Animals & Nature", label: "Nature", icon: "🐻" },
	{ key: "Food & Drink", label: "Food", icon: "🍕" },
	{ key: "Activities", label: "Activities", icon: "⚽" },
	{ key: "Travel & Places", label: "Travel", icon: "✈️" },
	{ key: "Objects", label: "Objects", icon: "💡" },
	{ key: "Symbols", label: "Symbols", icon: "❤️" },
	{ key: "Flags", label: "Flags", icon: "🏁" },
];

const RECENT_KEY = "ysong:emoji-recent";
const MAX_RECENT = 48;

function loadRecent() {
	try {
		const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
		return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, MAX_RECENT) : [];
	} catch {
		return [];
	}
}

function saveRecent(values: string[]) {
	try { localStorage.setItem(RECENT_KEY, JSON.stringify(values.slice(0, MAX_RECENT))); } catch { /* best-effort local UI action */ }
}

export default function EmojiPickerButton({ inputRef, value, onChange, buttonClassName = "" }: EmojiPickerButtonProps) {
	const [open, setOpen] = useState(false);
	const [category, setCategory] = useState("recent");
	const [search, setSearch] = useState("");
	const [recent, setRecent] = useState<string[]>(() => loadRecent());
	const anchorRef = useRef<HTMLButtonElement | null>(null);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const [pos, setPos] = useState<PickerPosition>({ left: 8, top: 48, width: 380, maxHeight: 470 });

	const recentEntries = useMemo(() => {
		const byEmoji = new Map(EMOJI_DATA.map((entry) => [entry.emoji, entry]));
		return recent.map((emoji) => byEmoji.get(emoji) || { emoji, name: "Recent emoji", group: "Recent", subgroup: "" });
	}, [recent]);

	const visible = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (q) {
			return EMOJI_DATA.filter((entry) => `${entry.name} ${entry.group} ${entry.subgroup}`.toLowerCase().includes(q));
		}
		if (category === "recent") return recentEntries;
		return EMOJI_DATA.filter((entry) => entry.group === category);
	}, [search, category, recentEntries]);

	useEffect(() => {
		if (!open) return;
		const reposition = () => {
			const rect = anchorRef.current?.getBoundingClientRect();
			if (!rect) return;
			const margin = 10;
			const gap = 8;
			const width = Math.min(390, Math.max(290, window.innerWidth - margin * 2));
			const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin));
			const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
			const above = Math.max(0, rect.top - gap - margin);
			const desired = 470;
			if (below < 320 && above > below) setPos({ left, bottom: window.innerHeight - rect.top + gap, width, maxHeight: Math.min(desired, Math.max(260, above)) });
			else setPos({ left, top: rect.bottom + gap, width, maxHeight: Math.min(desired, Math.max(260, below)) });
		};
		const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
		reposition();
		window.addEventListener("resize", reposition);
		window.addEventListener("scroll", reposition, true);
		window.addEventListener("keydown", onKey);
		requestAnimationFrame(() => searchRef.current?.focus());
		return () => {
			window.removeEventListener("resize", reposition);
			window.removeEventListener("scroll", reposition, true);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const insert = (entry: EmojiEntry) => {
		const input = inputRef.current;
		const start = input?.selectionStart ?? value.length;
		const end = input?.selectionEnd ?? start;
		const next = value.slice(0, start) + entry.emoji + value.slice(end);
		onChange(next);
		const nextRecent = [entry.emoji, ...recent.filter((x) => x !== entry.emoji)].slice(0, MAX_RECENT);
		setRecent(nextRecent);
		saveRecent(nextRecent);
		requestAnimationFrame(() => {
			input?.focus();
			const caret = start + entry.emoji.length;
			input?.setSelectionRange(caret, caret);
		});
	};

	const picker = open && typeof document !== "undefined" ? createPortal(
		<>
			<button className="fixed inset-0 z-[118] cursor-default" aria-label="Close emoji picker" onClick={() => setOpen(false)} />
			<div
				className="fixed z-[119] overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl text-neutral-100"
				style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
				onPointerDown={(event) => event.stopPropagation()}
			>
				<div className="p-3 border-b border-neutral-800 bg-neutral-950/95 sticky top-0 z-10">
					<div className="flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900 px-3">
						<span className="text-neutral-500">⌕</span>
						<input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search emoji" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" />
						{search && <button className="text-neutral-500 hover:text-white" onClick={() => setSearch("")} aria-label="Clear emoji search">✕</button>}
					</div>
					<div className="flex gap-1 overflow-x-auto no-scrollbar mt-2" role="tablist" aria-label="Emoji categories">
						{CATEGORY_META.map((item) => <button key={item.key} title={item.label} aria-label={item.label} aria-selected={!search && category === item.key} onClick={() => { setCategory(item.key); setSearch(""); }} className={`h-8 w-8 shrink-0 rounded-lg grid place-items-center text-lg ${!search && category === item.key ? "bg-indigo-500/20 ring-1 ring-indigo-400/40" : "hover:bg-neutral-800"}`}>{item.icon}</button>)}
					</div>
				</div>
				<div className="overflow-y-auto p-2" style={{ maxHeight: Math.max(170, pos.maxHeight - 112) }}>
					<div className="px-1 pb-2 text-[11px] uppercase tracking-wider text-neutral-500">{search ? `${visible.length} results` : CATEGORY_META.find((x) => x.key === category)?.label || category}</div>
					{visible.length === 0 ? <div className="p-8 text-center text-sm text-neutral-500">{category === "recent" && !search ? "Your recently used emoji will appear here." : "No emoji found."}</div> : <div className="grid grid-cols-8 sm:grid-cols-9 gap-0.5">{visible.map((entry, index) => <button key={`${entry.emoji}-${index}`} type="button" title={entry.name} aria-label={entry.name} onClick={() => insert(entry)} className="aspect-square min-h-9 rounded-lg text-[22px] leading-none grid place-items-center hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{entry.emoji}</button>)}</div>}
				</div>
			</div>
		</>,
		document.body
	) : null;

	return <>
		<button ref={anchorRef} type="button" onClick={() => setOpen((v) => !v)} className={`grid place-items-center rounded-lg hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${buttonClassName}`} aria-label="Choose emoji" title="Emoji" aria-expanded={open}>☺</button>
		{picker}
	</>;
}
