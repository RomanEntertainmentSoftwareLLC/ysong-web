import { useEffect, useRef, useState } from "react";
import type { TabRecord } from "./core";
import type { Chat } from "../components/UISidebar";
import { fetchChatMessages, appendMessage } from "../lib/chatApi";
import { YSButton } from "../components/YSButton";
import { FilePill } from "../components/FilePill";
import { audioController, type AudioAsset, type AudioTargetRef } from "../components/AudioController";

const env = (import.meta as any).env || {};

export const APP_NAME = env.VITE_APP_NAME ?? "YSong";

export const YSONG_WELCOME = `Yo! I\'m ${APP_NAME}, your built-in studio buddy.\n\nI can help with lyrics, hooks, chords, arrangement, and production ideas. Upload a file if you want and tell me the vibe you\'re chasing.`;

const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = (API_BASE || "").replace(/\/+$/, "");

type SignedUrlMode = "play" | "download";

/**
 * Fetch a short-lived signed URL from the backend.
 * Used to make private GCS objects playable/downloadable in the browser.
 */
async function fetchSignedUrl(objectKey: string, mode: SignedUrlMode = "play") {
	const token = localStorage.getItem("ys_token");
	if (!token) throw new Error("no_token");

	const base = API ? `${API}/api/uploads/signed-url` : `/api/uploads/signed-url`;
	const qs = new URLSearchParams({ objectKey, mode }).toString();

	const res = await fetch(`${base}?${qs}`, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!res.ok) throw new Error(`signed_url_failed_${res.status}`);

	const data = await res.json();

	const signed = typeof data?.url === "string" ? data.url : typeof data?.signedUrl === "string" ? data.signedUrl : "";

	const expiresAt =
		typeof data?.expiresAt === "number" && Number.isFinite(data.expiresAt)
			? data.expiresAt
			: Date.now() + 55 * 60 * 1000;

	if (!signed) throw new Error("signed_url_missing");

	return { url: signed, expiresAt };
}

// Zero-width space: lets us save “empty” messages (file-only) without tripping
// “missing_role_or_content” in storage/LLM pipelines.
const ZWSP = "\u200B";

type Props = {
	tab: TabRecord; // expects payload.chatId
	chats: Chat[];
	setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
};

type Attachment = {
	name: string;
	size: number;
	type: string;
	publicUrl?: string;
	objectKey?: string;
};

type ChatMessage = {
	id?: string;
	role: "user" | "assistant";
	text: string;
	attachments?: Attachment[];
	token?: string;
	ts?: number; // timestamp (ms)
};

/* ---------- Emoji Picker (desktop-only) ---------- */
type EmojiCategoryKey =
	| "smileys"
	| "people"
	| "nature"
	| "food"
	| "travel"
	| "activities"
	| "objects"
	| "symbols"
	| "flags";

type EmojiDef = { ch: string; name: string; keywords: string[] };

const E = (ch: string, name: string, keywords: string[] = []): EmojiDef => ({
	ch,
	name,
	keywords,
});

const TWEMOJI_SVG_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/";

function twemojiSvgUrl(emoji: string): string {
	const codePoints = Array.from(emoji).map((c) => (c.codePointAt(0) ?? 0).toString(16));
	return `${TWEMOJI_SVG_BASE}${codePoints.join("-")}.svg`;
}

function isRegionalIndicatorFlag(emoji: string): boolean {
	const cps = Array.from(emoji).map((c) => c.codePointAt(0) ?? 0);
	return cps.length === 2 && cps.every((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff);
}

const FLAG_PAIR_RE = /([\u{1F1E6}-\u{1F1FF}]{2})/gu;

function renderTwemojiFlags(text: string) {
	if (!text) return text;

	const nodes: React.ReactNode[] = [];
	let last = 0;
	let found = false;

	for (const m of text.matchAll(FLAG_PAIR_RE)) {
		found = true;
		const idx = m.index ?? 0;
		const flag = m[1];

		if (idx > last) nodes.push(text.slice(last, idx));

		nodes.push(
			<img
				key={`flag-${idx}-${flag}`}
				src={twemojiSvgUrl(flag)}
				alt={flag}
				draggable={false}
				className="inline-block h-[1.05em] w-[1.05em] align-[-2px]"
			/>
		);

		last = idx + flag.length; // flag is 2 regional indicators (4 UTF-16 code units)
	}

	if (!found) return text;
	if (last < text.length) nodes.push(text.slice(last));

	return nodes;
}

const EMOJI_CATEGORIES: Array<{
	key: EmojiCategoryKey;
	label: string;
	icon: string;
	emojis: EmojiDef[];
}> = [
	{
		key: "smileys",
		label: "Smileys",
		icon: "😀",
		emojis: [
			E("😀", "grinning face", ["grin", "happy"]),
			E("😃", "grinning face with big eyes", ["happy"]),
			E("😄", "grinning face with smiling eyes", ["smile"]),
			E("😁", "beaming face with smiling eyes", ["grin"]),
			E("😆", "grinning squinting face", ["laugh"]),
			E("😅", "grinning face with sweat", ["relief"]),
			E("😂", "face with tears of joy", ["lol", "laugh"]),
			E("🤣", "rolling on the floor laughing", ["rofl", "laugh"]),
			E("😊", "smiling face with smiling eyes", ["blush"]),
			E("😇", "smiling face with halo", ["angel"]),
			E("🙂", "slightly smiling face", ["smile"]),
			E("🙃", "upside-down face", ["silly"]),
			E("😉", "winking face", ["wink"]),
			E("😍", "smiling face with heart-eyes", ["love"]),
			E("🥰", "smiling face with hearts", ["love", "adore"]),
			E("😘", "face blowing a kiss", ["kiss"]),
			E("😋", "face savoring food", ["yum"]),
			E("😛", "face with tongue", ["tongue"]),
			E("😜", "winking face with tongue", ["silly"]),
			E("🤪", "zany face", ["crazy"]),
			E("🤨", "face with raised eyebrow", ["skeptical"]),
			E("🧐", "face with monocle", ["inspect"]),
			E("🤓", "nerd face", ["glasses"]),
			E("😎", "smiling face with sunglasses", ["cool"]),
			E("🤩", "star-struck", ["wow"]),
			E("🥳", "partying face", ["party"]),
			E("😏", "smirking face", ["smirk"]),
			E("😒", "unamused face", ["meh"]),
			E("😞", "disappointed face", ["sad"]),
			E("😔", "pensive face", ["sad"]),
			E("😕", "confused face", ["confused"]),
			E("🙁", "slightly frowning face", ["sad"]),
			E("☹️", "frowning face", ["sad"]),
			E("🥺", "pleading face", ["please"]),
			E("😢", "crying face", ["cry"]),
			E("😭", "loudly crying face", ["sob"]),
			E("😤", "face with steam from nose", ["frustrated"]),
			E("😠", "angry face", ["mad"]),
			E("😡", "pouting face", ["mad"]),
			E("🤬", "face with symbols on mouth", ["swear"]),
			E("😳", "flushed face", ["embarrassed"]),
			E("😱", "face screaming in fear", ["shock"]),
			E("😰", "anxious face with sweat", ["nervous"]),
			E("😴", "sleeping face", ["sleep"]),
			E("🤗", "smiling face with open hands", ["hug"]),
			E("🤔", "thinking face", ["think"]),
			E("🤐", "zipper-mouth face", ["quiet"]),
			E("🙄", "face with rolling eyes", ["eye roll"]),
		],
	},
	{
		key: "people",
		label: "People",
		icon: "🙋",
		emojis: [
			E("👋", "waving hand", ["wave", "hello"]),
			E("🤚", "raised back of hand", ["hand"]),
			E("✋", "raised hand", ["stop"]),
			E("🖐️", "hand with fingers splayed", ["hand"]),
			E("🖖", "vulcan salute", ["spock"]),
			E("👍", "thumbs up", ["like", "approve"]),
			E("👎", "thumbs down", ["dislike"]),
			E("✊", "raised fist", ["solidarity"]),
			E("👊", "oncoming fist", ["fist", "bump"]),
			E("🤝", "handshake", ["deal"]),
			E("🙌", "raising hands", ["praise"]),
			E("🙏", "folded hands", ["pray", "thanks"]),
			E("🫶", "heart hands", ["love"]),
			E("💪", "flexed biceps", ["strong"]),
			E("🧠", "brain", ["mind"]),
			E("👀", "eyes", ["look"]),
			E("🫦", "biting lip", ["lip"]),
			E("🧑‍💻", "technologist", ["coder", "dev"]),
			E("🧑‍🎤", "singer", ["music"]),
			E("🧑‍🎨", "artist", ["paint"]),
			E("🧑‍🍳", "cook", ["chef"]),
			E("🧑‍🚀", "astronaut", ["space"]),
			E("🧑‍⚕️", "health worker", ["doctor"]),
			E("🧑‍🎓", "student", ["grad"]),
			E("👶", "baby", ["infant"]),
			E("🧒", "child", ["kid"]),
			E("👧", "girl", ["kid"]),
			E("👦", "boy", ["kid"]),
			E("👩", "woman", ["adult"]),
			E("👨", "man", ["adult"]),
			E("👵", "older woman", ["grandma"]),
			E("👴", "older man", ["grandpa"]),
		],
	},
	{
		key: "nature",
		label: "Animals & Nature",
		icon: "🐻",
		emojis: [
			E("🐶", "dog face", ["dog"]),
			E("🐱", "cat face", ["cat"]),
			E("🐭", "mouse face", ["mouse"]),
			E("🐹", "hamster", ["hamster"]),
			E("🐰", "rabbit face", ["bunny"]),
			E("🦊", "fox", ["fox"]),
			E("🐻", "bear", ["bear"]),
			E("🐼", "panda", ["panda"]),
			E("🐨", "koala", ["koala"]),
			E("🦁", "lion", ["lion"]),
			E("🐯", "tiger face", ["tiger"]),
			E("🐮", "cow face", ["cow"]),
			E("🐷", "pig face", ["pig"]),
			E("🐸", "frog", ["frog"]),
			E("🐵", "monkey face", ["monkey"]),
			E("🐔", "chicken", ["chicken"]),
			E("🐧", "penguin", ["penguin"]),
			E("🐦", "bird", ["bird"]),
			E("🦋", "butterfly", ["butterfly"]),
			E("🐝", "honeybee", ["bee"]),
			E("🐢", "turtle", ["turtle"]),
			E("🐍", "snake", ["snake"]),
			E("🐙", "octopus", ["octopus"]),
			E("🐠", "tropical fish", ["fish"]),
			E("🐬", "dolphin", ["dolphin"]),
			E("🦈", "shark", ["shark"]),
			E("🌳", "deciduous tree", ["tree"]),
			E("🌿", "herb", ["plant"]),
			E("🌸", "cherry blossom", ["flower"]),
			E("🌻", "sunflower", ["flower"]),
			E("🌙", "crescent moon", ["moon"]),
			E("⭐", "star", ["star"]),
			E("☀️", "sun", ["sun"]),
			E("🌈", "rainbow", ["rainbow"]),
			E("❄️", "snowflake", ["snow"]),
			E("🔥", "fire", ["lit"]),
		],
	},
	{
		key: "food",
		label: "Food & Drink",
		icon: "🍔",
		emojis: [
			E("🍎", "red apple", ["apple"]),
			E("🍌", "banana", ["banana"]),
			E("🍉", "watermelon", ["melon"]),
			E("🍇", "grapes", ["grape"]),
			E("🍓", "strawberry", ["berry"]),
			E("🫐", "blueberries", ["berry"]),
			E("🍒", "cherries", ["cherry"]),
			E("🍑", "peach", ["peach"]),
			E("🥭", "mango", ["mango"]),
			E("🍍", "pineapple", ["pineapple"]),
			E("🥑", "avocado", ["avocado"]),
			E("🥦", "broccoli", ["broccoli"]),
			E("🌶️", "hot pepper", ["spicy"]),
			E("🧄", "garlic", ["garlic"]),
			E("🥔", "potato", ["potato"]),
			E("🍞", "bread", ["bread"]),
			E("🥐", "croissant", ["pastry"]),
			E("🧀", "cheese wedge", ["cheese"]),
			E("🥚", "egg", ["egg"]),
			E("🥞", "pancakes", ["pancake"]),
			E("🥓", "bacon", ["bacon"]),
			E("🍗", "poultry leg", ["chicken"]),
			E("🍔", "hamburger", ["burger"]),
			E("🍟", "french fries", ["fries"]),
			E("🍕", "pizza", ["pizza"]),
			E("🌭", "hot dog", ["hotdog"]),
			E("🌮", "taco", ["taco"]),
			E("🍣", "sushi", ["sushi"]),
			E("🍜", "steaming bowl", ["ramen", "noodles"]),
			E("🍩", "doughnut", ["donut"]),
			E("🍪", "cookie", ["cookie"]),
			E("🍫", "chocolate bar", ["chocolate"]),
			E("🧁", "cupcake", ["cake"]),
			E("☕", "hot beverage", ["coffee"]),
			E("🧋", "bubble tea", ["boba"]),
			E("🥤", "cup with straw", ["soda"]),
			E("🍺", "beer mug", ["beer"]),
			E("🍷", "wine glass", ["wine"]),
		],
	},
	{
		key: "travel",
		label: "Travel & Places",
		icon: "✈️",
		emojis: [
			E("🚗", "car", ["car"]),
			E("🚕", "taxi", ["taxi"]),
			E("🚌", "bus", ["bus"]),
			E("🚆", "train", ["train"]),
			E("🚇", "metro", ["subway"]),
			E("🚲", "bicycle", ["bike"]),
			E("🛴", "kick scooter", ["scooter"]),
			E("✈️", "airplane", ["flight"]),
			E("🛫", "airplane departure", ["takeoff"]),
			E("🛬", "airplane arrival", ["landing"]),
			E("🚀", "rocket", ["rocket"]),
			E("🛸", "flying saucer", ["ufo"]),
			E("⛵", "sailboat", ["boat"]),
			E("🚢", "ship", ["boat"]),
			E("🗺️", "world map", ["map"]),
			E("🧭", "compass", ["compass"]),
			E("🗽", "statue of liberty", ["nyc"]),
			E("🗼", "tokyo tower", ["tokyo"]),
			E("🏰", "castle", ["castle"]),
			E("🏯", "japanese castle", ["castle"]),
			E("🏟️", "stadium", ["stadium"]),
			E("🏖️", "beach with umbrella", ["beach"]),
			E("🏝️", "desert island", ["island"]),
			E("🏕️", "camping", ["camp"]),
			E("⛺", "tent", ["tent"]),
			E("🌋", "volcano", ["volcano"]),
			E("🗻", "mount fuji", ["mountain"]),
		],
	},
	{
		key: "activities",
		label: "Activities",
		icon: "⚽",
		emojis: [
			E("⚽", "soccer ball", ["soccer", "football"]),
			E("🏀", "basketball", ["basketball"]),
			E("🏈", "american football", ["football"]),
			E("⚾", "baseball", ["baseball"]),
			E("🎾", "tennis", ["tennis"]),
			E("🎮", "video game", ["game"]),
			E("🎲", "game die", ["dice"]),
			E("🧩", "puzzle piece", ["puzzle"]),
			E("♟️", "chess pawn", ["chess"]),
			E("🎯", "bullseye", ["target"]),
			E("🎹", "musical keyboard", ["piano"]),
			E("🥁", "drum", ["drums"]),
			E("🎸", "guitar", ["guitar"]),
			E("🎻", "violin", ["violin"]),
			E("🎺", "trumpet", ["trumpet"]),
			E("🎷", "saxophone", ["sax"]),
			E("🎤", "microphone", ["sing"]),
			E("🎧", "headphone", ["music"]),
			E("🎬", "clapper board", ["movie"]),
			E("🎨", "artist palette", ["art"]),
		],
	},
	{
		key: "objects",
		label: "Objects",
		icon: "💡",
		emojis: [
			E("💡", "light bulb", ["idea"]),
			E("📎", "paperclip", ["clip"]),
			E("📌", "pushpin", ["pin"]),
			E("📍", "round pushpin", ["location"]),
			E("🎁", "wrapped gift", ["gift"]),
			E("🎈", "balloon", ["balloon"]),
			E("🎉", "party popper", ["party"]),
			E("🔧", "wrench", ["tool"]),
			E("🪛", "screwdriver", ["tool"]),
			E("🔨", "hammer", ["tool"]),
			E("⚙️", "gear", ["settings"]),
			E("🖥️", "desktop computer", ["computer"]),
			E("💻", "laptop", ["laptop"]),
			E("⌨️", "keyboard", ["keyboard"]),
			E("🖱️", "computer mouse", ["mouse"]),
			E("📱", "mobile phone", ["phone"]),
			E("📷", "camera", ["photo"]),
			E("🎥", "movie camera", ["video"]),
			E("💾", "floppy disk", ["save"]),
			E("🔊", "speaker high volume", ["sound"]),
			E("🔇", "muted speaker", ["mute"]),
			E("🔔", "bell", ["notification"]),
			E("⏰", "alarm clock", ["alarm"]),
			E("🔋", "battery", ["battery"]),
			E("🔌", "electric plug", ["plug"]),
			E("🔬", "microscope", ["science"]),
			E("🔭", "telescope", ["space"]),
		],
	},
	{
		key: "symbols",
		label: "Symbols",
		icon: "❤️",
		emojis: [
			E("❤️", "red heart", ["heart", "love"]),
			E("🧡", "orange heart", ["heart"]),
			E("💛", "yellow heart", ["heart"]),
			E("💚", "green heart", ["heart"]),
			E("💙", "blue heart", ["heart"]),
			E("💜", "purple heart", ["heart"]),
			E("🖤", "black heart", ["heart"]),
			E("🤍", "white heart", ["heart"]),
			E("💔", "broken heart", ["heartbreak"]),
			E("💕", "two hearts", ["love"]),
			E("💞", "revolving hearts", ["love"]),
			E("✨", "sparkles", ["sparkle"]),
			E("✅", "check mark button", ["check", "ok"]),
			E("☑️", "check box with check", ["check"]),
			E("✔️", "check mark", ["check"]),
			E("❌", "cross mark", ["x"]),
			E("⚠️", "warning", ["alert"]),
			E("⛔", "no entry", ["stop"]),
			E("🚫", "prohibited", ["no"]),
			E("ℹ️", "information", ["info"]),
			E("❓", "question mark", ["question"]),
			E("❗", "exclamation mark", ["exclamation"]),
			E("⭐", "star", ["star"]),
			E("♾️", "infinity", ["infinite"]),
			E("🔞", "no one under eighteen", ["18+"]),
		],
	},
	{
		key: "flags",
		label: "Flags",
		icon: "🏳️",
		emojis: [
			E("🏁", "chequered flag", ["race"]),
			E("🚩", "triangular flag", ["flag"]),
			E("🎌", "crossed flags", ["flags"]),
			E("🏴‍☠️", "pirate flag", ["pirate"]),
			E("🇺🇸", "flag: United States", ["usa", "us"]),
			E("🇦🇷", "flag: Argentina", ["argentina", "ar"]),
			E("🇲🇽", "flag: Mexico", ["mexico", "mx"]),
			E("🇨🇦", "flag: Canada", ["canada", "ca"]),
			E("🇧🇷", "flag: Brazil", ["brazil", "br"]),
			E("🇬🇧", "flag: United Kingdom", ["uk", "gb"]),
			E("🇮🇪", "flag: Ireland", ["ireland", "ie"]),
			E("🇫🇷", "flag: France", ["france", "fr"]),
			E("🇩🇪", "flag: Germany", ["germany", "de"]),
			E("🇮🇹", "flag: Italy", ["italy", "it"]),
			E("🇪🇸", "flag: Spain", ["spain", "es"]),
			E("🇵🇹", "flag: Portugal", ["portugal", "pt"]),
			E("🇯🇵", "flag: Japan", ["japan", "jp"]),
			E("🇰🇷", "flag: South Korea", ["korea", "kr"]),
			E("🇨🇳", "flag: China", ["china", "cn"]),
			E("🇮🇳", "flag: India", ["india", "in"]),
			E("🇦🇺", "flag: Australia", ["australia", "au"]),
			E("🇪🇺", "flag: European Union", ["eu"]),
		],
	},
];

type EmojiItem = EmojiDef & { cat: EmojiCategoryKey };

const EMOJI_BY_CAT: Record<EmojiCategoryKey, EmojiItem[]> = (() => {
	const map = {
		smileys: [] as EmojiItem[],
		people: [] as EmojiItem[],
		nature: [] as EmojiItem[],
		food: [] as EmojiItem[],
		travel: [] as EmojiItem[],
		activities: [] as EmojiItem[],
		objects: [] as EmojiItem[],
		symbols: [] as EmojiItem[],
		flags: [] as EmojiItem[],
	};

	for (const cat of EMOJI_CATEGORIES) {
		for (const e of cat.emojis) {
			map[cat.key].push({ ...e, cat: cat.key });
		}
	}
	return map;
})();

const EMOJI_INDEX: EmojiItem[] = (() => {
	const out: EmojiItem[] = [];
	for (const k of Object.keys(EMOJI_BY_CAT) as EmojiCategoryKey[]) {
		out.push(...EMOJI_BY_CAT[k]);
	}
	return out;
})();

function emojiMatchesQuery(e: EmojiItem, q: string) {
	if (!q) return true;
	const s = q.toLowerCase();
	if (e.ch.includes(s)) return true;
	if (e.name.toLowerCase().includes(s)) return true;
	return e.keywords.some((kw) => kw.toLowerCase().includes(s));
}

// --- Unicode helpers (fix garbled/square filenames, normalize text rendering) ---
function maybeDecodeURIComponentSafe(s: string): string {
	if (!s) return s;
	// Only try decode when it looks percent-encoded.
	if (!/%[0-9A-Fa-f]{2}/.test(s)) return s;
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

function normalizeUnicodeText(s: string): string {
	if (typeof s !== "string") return "";
	// NFC is the safest “display” normalization for filenames/text.
	try {
		return s.normalize("NFC");
	} catch {
		return s;
	}
}

function normalizeFilenameDisplay(name: string): string {
	return normalizeUnicodeText(maybeDecodeURIComponentSafe(name || ""));
}

function deriveObjectKeyFromPublicUrl(url?: string): string | undefined {
	if (!url) return;

	try {
		const u = new URL(url);

		// https://storage.googleapis.com/<bucket>/<objectKey>
		if (u.hostname === "storage.googleapis.com") {
			const parts = u.pathname.split("/").filter(Boolean);
			if (parts.length >= 2) {
				// drop bucket (parts[0]), keep the rest
				return decodeURIComponent(parts.slice(1).join("/"));
			}
		}

		// https://<bucket>.storage.googleapis.com/<objectKey>
		if (u.hostname.endsWith(".storage.googleapis.com")) {
			const key = u.pathname.replace(/^\/+/, "");
			return key ? decodeURIComponent(key) : undefined;
		}
	} catch {
		// ignore
	}

	return;
}

function normalizeAttachment(raw: any): Attachment {
	if (typeof raw === "string") {
		return { name: normalizeFilenameDisplay(raw), size: 0, type: "" };
	}

	const nameRaw =
		typeof raw?.name === "string" ? raw.name : typeof raw?.filename === "string" ? raw.filename : "Unknown file";

	const size = typeof raw?.size === "number" ? raw.size : typeof raw?.bytes === "number" ? raw.bytes : 0;

	const type = typeof raw?.type === "string" ? raw.type : typeof raw?.contentType === "string" ? raw.contentType : "";

	// accept legacy keys too
	const publicUrl = raw?.publicUrl ?? raw?.public_url ?? raw?.url ?? raw?.publicURL ?? undefined;

	let objectKey = raw?.objectKey ?? raw?.object_key ?? raw?.gcsObjectKey ?? raw?.gcs_key ?? undefined;

	// if we only have the GCS url, derive objectKey from it
	if (!objectKey) objectKey = deriveObjectKeyFromPublicUrl(publicUrl);

	const name = normalizeFilenameDisplay(String(nameRaw));

	return { name, size, type, publicUrl, objectKey };
}

function sanitizeEmDashesToSentences(text: string): string {
	if (!text) return text;

	let out = text;

	// Case 1: middle-of-sentence clause, like "nice — this feels..."
	// Turn: "<char><spaces>—<spaces><letter>" into "<char>. <CapitalLetter>"
	// Unicode-aware: \p{L} instead of A-Za-z
	out = out.replace(/(\S)\s*\u2014\s*(\p{L})/gu, (_m, before, after) => {
		return `${before}. ${String(after).toUpperCase()}`;
	});

	// Case 2: leftover em dashes → break the clause.
	out = out.replace(/\s*\u2014\s*/g, ". ");

	return out;
}

function redactAssetSecrets(text: string): string {
	if (!text) return text;

	let out = text;

	// Common leaks from internal asset metadata
	out = out.replace(/^\s*objectKey:\s*.+$/gim, "");
	out = out.replace(/user-uploads\/[\w\-./%]+/g, "[redacted]");
	out = out.replace(/https?:\/\/storage\.googleapis\.com\/[\w\-./%?=&]+/g, "[redacted-url]");
	out = out.replace(/https?:\/\/[\w\-]+\.storage\.googleapis\.com\/[\w\-./%?=&]+/g, "[redacted-url]");

	// Tidy up extra blank lines caused by removals
	out = out.replace(/\n{3,}/g, "\n\n");

	return out.trim();
}

function stripAudioCommandHints(text: string): string {
	if (!text) return text;
	let out = text;

	// When playback is handled by the app, we don't want the assistant to instruct
	// the user to type exact commands/filenames.
	out = out.replace(/^\s*(?:type|just\s+type|try\s+typing|you\s+can\s+type)\s*:?\s*play\b.*$/gim, "");
	out = out.replace(/^\s*play\s+"?.+"?\s+and\s+i'?ll\s+trigger\b.*$/gim, "");

	out = out.replace(/\n{3,}/g, "\n\n");
	return out.trim();
}

// Remove any internal tool-tag protocol text from what the user sees.
// (The assistant may still emit these tags; the app should never render them.)
function stripYsToolTags(text: string): string {
	if (!text) return text;
	let out = text;

	// Use a non-greedy matcher so tags still strip even if attribute values contain ']'
	// (e.g. id="[redacted] ..."), which would break a naive [^\]]* regex.
	out = out.replace(/\[\[ys:[\s\S]*?\]\]/gi, "");
	out = out.replace(/\n{3,}/g, "\n\n");
	return out.trim();
}

function fileKey(f: File) {
	return `${f.name}:${f.size}:${f.lastModified}`;
}

function fmtMB(bytes: number) {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadLabel(atts?: Attachment[]) {
	const list = Array.isArray(atts) ? atts : [];
	if (list.length === 0) return "";

	if (list.length === 1) {
		const a = list[0];
		return `Uploaded: ${a.name} (${fmtMB(a.size)})`;
	}

	const names = list.map((a) => a.name).join(", ");
	return `Uploaded ${list.length} files: ${names}`;
}

type AudioAction =
	| { kind: "play" | "resume"; ref: AudioTargetRef }
	| { kind: "pause" | "stop"; ref?: AudioTargetRef }
	| { kind: "seekFrac"; fraction: number; ref?: AudioTargetRef }
	| { kind: "seekSeconds"; seconds: number; ref?: AudioTargetRef };

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|aiff|aif|alac|mp4)$/i;

function isAudioAttachment(a?: Attachment) {
	if (!a) return false;
	const t = (a.type || "").toLowerCase();
	if (t.startsWith("audio/")) return true;
	if (typeof a.name === "string" && AUDIO_EXT_RE.test(a.name)) return true;
	return false;
}

function collectAudioAssetsFromChats(allChats: Chat[], limit = 250): AudioAsset[] {
	const out: AudioAsset[] = [];
	const seen = new Set<string>();

	// Iterate newest → oldest so “last” means most recent.
	for (let ci = allChats.length - 1; ci >= 0; ci--) {
		const c = allChats[ci];
		const msgs = Array.isArray(c.messages) ? (c.messages as any[]) : [];
		for (let mi = msgs.length - 1; mi >= 0; mi--) {
			const m = msgs[mi];
			const atts = Array.isArray(m.attachments) ? m.attachments : [];
			for (const raw of atts) {
				const a = normalizeAttachment(raw);
				if (!isAudioAttachment(a)) continue;

				const id = a.objectKey ?? a.publicUrl ?? (m.id ? `${m.id}:${a.name}` : `${a.name}:${a.size}`);

				if (seen.has(id)) continue;
				seen.add(id);

				out.push({
					id,
					name: a.name,
					type: "audio",
					sizeMB: a.size ? Math.max(0, Math.round((a.size / (1024 * 1024)) * 10) / 10) : 0,
					publicUrl: a.publicUrl,
					objectKey: a.objectKey,
				});

				if (out.length >= limit) return out;
			}
		}
	}

	return out;
}

function normalizeName(s: string) {
	return (
		(s || "")
			.trim()
			.toLowerCase()
			// strip quote-like chars
			.replace(/["'`]/g, "")
			// normalize punctuation to spaces so queries like "Glass Alice?" still match
			.replace(/[^\p{L}\p{N}\s.\-]/gu, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
}

function pickRandomAsset(list: AudioAsset[], avoidId?: string) {
	if (!list.length) return undefined;
	if (list.length === 1) return list[0];

	// Avoid repeating the last played track when possible.
	const filtered = avoidId ? list.filter((a) => a.id !== avoidId) : list;
	const pool = filtered.length ? filtered : list;
	const idx = Math.floor(Math.random() * pool.length);
	return pool[idx];
}

function bestMatchAsset(query: string | undefined, assets: AudioAsset[]) {
	if (!assets.length) return;

	const avoidId = audioController.getSnapshot().lastPlayedId;

	const q0 = normalizeName(query || "");
	if (!q0 || q0 === "last" || q0 === "latest" || q0 === "current") {
		return assets[0]; // newest first
	}

	const wantsRandom = /\b(random|shuffle|surprise|anything|any|whatever)\b/i.test(q0);
	const cleaned = q0
		.replace(/\b(random|shuffle|surprise|anything|any|whatever)\b/gi, " ")
		.replace(/\b(song|track|music|band)\b/gi, " ")
		.replace(/\s+/g, " ")
		.trim();

	const q = cleaned || q0;

	// Exact (case-insensitive) filename match.
	const exact = assets.find((a) => normalizeName(a.name) === q);
	if (exact) return exact;

	// Match without extension (e.g. “drums” matches “drums.wav”)
	const qNoExt = q.replace(/\.[a-z0-9]+$/i, "");
	const noExtExact = assets.find((a) => normalizeName(a.name).replace(/\.[a-z0-9]+$/i, "") === qNoExt);
	if (noExtExact) return noExtExact;

	// Substring matches
	const hits = q ? assets.filter((a) => normalizeName(a.name).includes(q)) : [];
	if (hits.length === 1) return hits[0];
	if (hits.length > 1) return pickRandomAsset(hits, avoidId);

	const hits2 = qNoExt
		? assets.filter((a) =>
				normalizeName(a.name)
					.replace(/\.[a-z0-9]+$/i, "")
					.includes(qNoExt)
		  )
		: [];
	if (hits2.length === 1) return hits2[0];
	if (hits2.length > 1) return pickRandomAsset(hits2, avoidId);

	// Explicit random request with no other match: pick from the whole list.
	if (wantsRandom) return pickRandomAsset(assets, avoidId);

	return;
}

function parseTimeToSeconds(raw: string): number | undefined {
	const s = (raw || "").trim().toLowerCase();
	if (!s) return;

	// 90%, 12.5%
	const pct = s.match(/^([0-9]{1,3}(?:\.[0-9]+)?)\s*%$/);
	if (pct) return; // handled elsewhere as fraction

	// hh:mm:ss or mm:ss
	const colon = s.match(/^([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?$/);
	if (colon) {
		const a = Number(colon[1]);
		const b = Number(colon[2]);
		const c = colon[3] != null ? Number(colon[3]) : undefined;
		if (Number.isNaN(a) || Number.isNaN(b) || (c != null && Number.isNaN(c))) return;
		return c == null ? a * 60 + b : a * 3600 + b * 60 + c;
	}

	// 1m30s, 2m, 45s, 1.5m
	const mmss = s.match(/^(?:(\d+(?:\.\d+)?)\s*h\s*)?(?:(\d+(?:\.\d+)?)\s*m\s*)?(?:(\d+(?:\.\d+)?)\s*s\s*)?$/);
	if (mmss) {
		const h = mmss[1] ? Number(mmss[1]) : 0;
		const m = mmss[2] ? Number(mmss[2]) : 0;
		const sec = mmss[3] ? Number(mmss[3]) : 0;
		if ([h, m, sec].some((n) => Number.isNaN(n))) return;
		const total = h * 3600 + m * 60 + sec;
		if (total > 0) return total;
	}

	// plain seconds number
	const num = s.match(/^\d+(?:\.\d+)?$/);
	if (num) return Number(s);

	return;
}

function parseUserAudioCommands(textRaw: string, audioAssets: AudioAsset[]): AudioAction[] | null {
	const t = (textRaw ?? "").trim();
	if (!t) return null;

	// Natural phrasing support:
	// "play X", "could you play X", "please play X", "can you pause", "seek 1:23", etc.
	const headRe =
		/^\s*(?:(?:ok|okay|alright|all right|hey|yo|pls|please|could you|can you|would you|would ya|can ya|now|then|so|well|alrighty|allright)\s+)*\b(play|resume|pause|stop|seek)\b/i;
	const m = t.match(headRe);
	if (!m) return null;

	const verb = String(m[1]).toLowerCase() as "play" | "resume" | "pause" | "stop" | "seek";

	const tailRaw = t.slice(m[0].length).trim();

	const newest = audioAssets[0];

	const refFromAsset = (a?: AudioAsset): AudioTargetRef | undefined => {
		if (!a) return;
		return {
			id: a.id,
			name: a.name,
			objectKey: a.objectKey,
			publicUrl: a.publicUrl,
		};
	};

	const stripFiller = (s: string) =>
		(s || "")
			.trim()
			.replace(/^to\s+/i, "")
			.replace(/\b(?:for\s+me|please|pls|now|right\s+now|thanks|thank\s+you)\b/gi, "")
			// Generic words that shouldn't affect matching
			.replace(/\b(?:song|track|tune|audio|music|file|mp3|wav|m4a|flac)\b/gi, "")
			.replace(/\b(?:random|any|something)\b/gi, "")
			// Strip common emoticons so ":P" doesn't become a stray "p" token and break matching.
			.replace(/(?:^|\s)(?:[:;=8]|x|X)(?:-)?(?:\)|\(|d|D|p|P)(?=\s|$)/g, " ")
			.replace(/(?:^|\s)<3(?=\s|$)/g, " ")
			// Phrases users commonly add that shouldn't affect matching.
			.replace(/\b(?:from|in)\s+(?:the\s+)?asset\s+drawer\b/gi, "")
			.replace(/\b(?:from|in)\s+(?:the\s+)?drawer\b/gi, "")
			.replace(/\b(?:from|in)\s+(?:the\s+)?assets\b/gi, "")
			.replace(
				/^(?:me\s+)?(?:some\s+of\s+that|some|something(?:\s+(?:by|from))?|of|that|this|the|a|an)\b\s*/i,
				""
			)
			.replace(/^by\s+/i, "")
			.replace(/\s{2,}/g, " ")
			.trim();

	// If they quote a filename, prefer it.
	const quoted = t.match(/["'`]\s*([^"'`]+?)\s*["'`]/)?.[1];

	if (verb === "pause") return [{ kind: "pause" }];
	if (verb === "stop") return [{ kind: "stop" }];

	if (verb === "play" || verb === "resume") {
		const wantsRandom = /\b(random|shuffle|surprise|anything|any|whatever)\b/i.test(quoted ?? tailRaw);
		const query = stripFiller(quoted ?? tailRaw);

		// If the user explicitly asked for random, and their query collapses to empty after
		// stripping filler words, pick a random track from the whole drawer.
		const avoidId = audioController.getSnapshot().lastPlayedId;
		const asset = wantsRandom
			? query
				? bestMatchAsset(query, audioAssets)
				: pickRandomAsset(audioAssets, avoidId)
			: bestMatchAsset(query || "last", audioAssets);

		const chosen = asset ?? newest ?? undefined;
		if (!chosen) return null;
		return [{ kind: verb, ref: refFromAsset(chosen)! }];
	}

	// seek parsing:
	// - "seek 75%" / "seek to 75%"
	// - "seek 1:23"
	// - "seek 90s" / "seek 1m30s"
	// If no file is specified, seek applies to the current track.
	if (verb === "seek") {
		let tail = tailRaw.replace(/^to\s+/i, "").trim();

		// If they included a quoted filename, remove it from tail so we can parse time.
		if (quoted) {
			tail = tail.replace(/["'`]\s*([^"'`]+?)\s*["'`]/, "").trim();
		}

		// Percent seek
		const pct = tail.match(/^([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:%|percent)?$/i);
		if (pct) {
			const p = Math.max(0, Math.min(100, Number(pct[1])));
			if (Number.isFinite(p)) {
				const query = stripFiller(quoted ?? "");
				const asset = query ? bestMatchAsset(query, audioAssets) : undefined;
				return [
					{
						kind: "seekFrac",
						fraction: p / 100,
						ref: refFromAsset(asset),
					},
				];
			}
		}

		// Time seek (seconds)
		const secs = parseTimeToSeconds(tail);
		if (typeof secs === "number" && Number.isFinite(secs)) {
			const query = stripFiller(quoted ?? "");
			const asset = query ? bestMatchAsset(query, audioAssets) : undefined;
			return [
				{
					kind: "seekSeconds",
					seconds: secs,
					ref: refFromAsset(asset),
				},
			];
		}

		return null;
	}

	return null;
}

function parseTagAttrs(attrText: string): Record<string, string> {
	const out: Record<string, string> = {};
	const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(attrText))) {
		const key = m[1];
		const val = m[2] ?? m[3] ?? m[4] ?? "";
		out[key] = val;
	}
	return out;
}

function extractAudioToolTags(text: string) {
	const actions: AudioAction[] = [];
	if (!text) return { cleaned: text, actions };

	// Non-greedy capture so values like id="[redacted] ..." (which contain ']')
	// don't break tag stripping.
	const tagRe = /\[\[ys:audio\.(play|resume|pause|stop|seek)\s*([\s\S]*?)\]\]/gi;

	const cleaned = text.replace(tagRe, (_full, verbRaw, attrsRaw) => {
		const verb = String(verbRaw).toLowerCase();
		const attrs = parseTagAttrs(String(attrsRaw || ""));

		const ref: AudioTargetRef = {
			id: attrs.id,
			objectKey: attrs.objectKey,
			publicUrl: attrs.publicUrl,
			name: attrs.name,
		};

		if (verb === "play" || verb === "resume") {
			actions.push({ kind: verb as any, ref });
			return "";
		}

		if (verb === "pause" || verb === "stop") {
			actions.push({ kind: verb as any, ref });
			return "";
		}

		if (verb === "seek") {
			const pct = attrs.pct ?? attrs.percent;
			if (pct) {
				const p = Math.max(0, Math.min(100, Number(pct)));
				if (Number.isFinite(p)) {
					// seek % applies to current track unless id supplied
					const currentId = audioController.getSnapshot().currentId;
					const useRef = ref.id || ref.objectKey || ref.publicUrl ? ref : { id: currentId };
					if (useRef?.id)
						actions.push({
							kind: "seekFrac",
							ref: useRef,
							fraction: p / 100,
						});
					return "";
				}
			}

			const secStr = attrs.seconds ?? attrs.s ?? attrs.t ?? "";
			const secs = parseTimeToSeconds(secStr);
			if (typeof secs === "number" && Number.isFinite(secs)) {
				const currentId = audioController.getSnapshot().currentId;
				const useRef = ref.id || ref.objectKey || ref.publicUrl ? ref : { id: currentId };
				if (useRef?.id)
					actions.push({
						kind: "seekSeconds",
						ref: useRef,
						seconds: secs,
					});
				return "";
			}
		}

		return "";
	});

	return { cleaned: cleaned.trim(), actions };
}

function buildAudioToolSystemMessage(audioAssets: Array<{ id: string; name: string }>) {
	const list = audioAssets
		.slice(0, 50)
		.map((a) => `- ${a.name} (id: ${a.id})`)
		.join("\n");

	return `
	AUDIO CONTROL (IN-APP)
	You can control playback directly.
	- If the user asks to play a song, do NOT ask them to type a command or filename.
	- Fuzzy match: if they mention any part of the title/artist, pick the closest match.
	- Prefer short, human replies. Avoid quoting full filenames and avoid file extensions unless the user does.
	- Do NOT print internal object keys or URLs in normal chat replies.
	- If you emit tool tags, place them AFTER the natural reply, each on its own line.
	- Never reply with only tool tags.
	- If the user asks for a random song or random song by an artist/band, pick a random matching item.

	Available audio assets (newest first):
	${list || "(none)"}

	Tool tags:
	[[ys:audio.play id="..."]]
	[[ys:audio.pause]]
	[[ys:audio.stop]]
	[[ys:audio.seek id="..." seconds="42"]]
	[[ys:audio.seek id="..." percent="0.5"]]
	`.trim();
}

function fmtTime(seconds: number) {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, "0");
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
	return `${m}:${ss}`;
}

function pickOne<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function friendlyTrackTitle(rawName: string) {
	let base = (rawName || "").trim();
	if (!base) return "";
	// Strip extension
	base = base.replace(/\.[a-z0-9]{1,6}$/i, "").trim();
	// Heuristic: "Artist - Title" → show "Title"
	const parts = base
		.split(" - ")
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length >= 2) return parts[parts.length - 1];
	return base;
}

function summarizeLocalAudioActions(actions: AudioAction[], assets: AudioAsset[]) {
	if (!actions.length) return "";
	const a0 = actions[0];

	const resolveName = (ref?: AudioTargetRef) => {
		const n0 = (ref?.name ?? "").trim();
		if (n0) return n0;

		const id = (ref?.id ?? "").trim();
		if (id) {
			const hit = assets.find((x) => x.id === id);
			if (hit?.name) return hit.name;
		}
		return "";
	};

	if (a0.kind === "play" || a0.kind === "resume") {
		const title = friendlyTrackTitle(resolveName(a0.ref));
		return title ? `Now playing: ${title}.` : "Now playing.";
	}

	if (a0.kind === "pause") return "Playback paused.";
	if (a0.kind === "stop") return "Playback stopped.";
	if (a0.kind === "seekSeconds") return `Seeked to ${fmtTime(a0.seconds)}.`;
	if (a0.kind === "seekFrac") {
		const pct = Math.round(a0.fraction * 100);
		return `Seeked to ${pct}%.`;
	}

	return "";
}

function fallbackAckForAudioActions(actions: AudioAction[], assets: AudioAsset[]) {
	if (!actions.length) return "…";

	const a0 = actions[0];

	const resolveName = (ref?: AudioTargetRef) => {
		const n0 = (ref?.name ?? "").trim();
		if (n0) return n0;

		const id = (ref?.id ?? "").trim();
		if (id) {
			const hit = assets.find((x) => x.id === id);
			if (hit?.name) return hit.name;
		}

		return "";
	};

	if (a0.kind === "play" || a0.kind === "resume") {
		const name = resolveName(a0.ref);
		const title = friendlyTrackTitle(name);
		const templates = name
			? [
					`Playing ${title || name}.`,
					`Alright — playing ${title || name}.`,
					`Queued up ${title || name}.`,
					`Spinning up ${title || name}.`,
			  ]
			: ["Playing that now.", "Alright — playing it.", "Got it. Starting playback.", "Kicking it on now."];
		return pickOne(templates);
	}

	if (a0.kind === "pause")
		return pickOne([
			"Alright, pausing it.",
			"Cool. Paused.",
			"Yep, putting it on pause.",
			"Got you. Pausing it for a sec.",
		]);
	if (a0.kind === "stop")
		return pickOne([
			"Okay, stopping it.",
			"All good. Stopped.",
			"Done. Stopped playback.",
			"Sure thing. Stopping it now.",
		]);

	if (a0.kind === "seekSeconds") {
		return pickOne([
			`Jumped to ${fmtTime(a0.seconds)}.`,
			`Skipping to ${fmtTime(a0.seconds)}.`,
			`Alright, seeking to ${fmtTime(a0.seconds)}.`,
		]);
	}

	if (a0.kind === "seekFrac") {
		const pct = Math.round(a0.fraction * 100);
		return pickOne([`Jumped to ${pct}%.`, `Skipping to ${pct}%.`, `Alright, seeking to ${pct}%.`]);
	}

	return "Done.";
}

function isoCountryToFlagEmoji(code: string) {
	const cc = (code || "").trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(cc)) return code;

	const A = "A".charCodeAt(0);
	const base = 0x1f1e6; // Regional Indicator Symbol Letter A

	const c0 = cc.charCodeAt(0) - A;
	const c1 = cc.charCodeAt(1) - A;

	return String.fromCodePoint(base + c0, base + c1);
}

export default function ChatPane({ tab, chats, setChats }: Props) {
	const showTimestamps = useShowTimestamps();
	const chatId = tab.payload?.chatId as string;
	const chat = chats.find((c) => c.id === chatId);
	const messageCount = chat?.messages?.length ?? 0;

	const [input, setInput] = useState("");

	// Emoji picker (desktop-only). Mobile already has OS emoji.
	const [emojiOpen, setEmojiOpen] = useState(false);
	const [emojiQuery, setEmojiQuery] = useState("");
	const [emojiCat, setEmojiCat] = useState<EmojiCategoryKey>("smileys");
	const emojiBtnRef = useRef<HTMLButtonElement | null>(null);
	const emojiPanelRef = useRef<HTMLDivElement | null>(null);
	const emojiSearchRef = useRef<HTMLInputElement | null>(null);
	const composerSelRef = useRef<{ start: number; end: number }>({
		start: 0,
		end: 0,
	});

	const [pendingFiles, setPendingFiles] = useState<File[]>([]);
	const [isUploading, setIsUploading] = useState(false);
	const [progressByKey, setProgressByKey] = useState<Record<string, number>>({});

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const signedUrlCacheRef = useRef<Map<string, { url: string; expiresAt: number }>>(new Map());

	const [autoTitleRequested, setAutoTitleRequested] = useState(false);

	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const bottomRef = useRef<HTMLDivElement | null>(null);

	const fetchedChatIdsRef = useRef<Set<string>>(new Set());

	// Keep AudioController's registry in sync with the Asset Drawer / uploaded audio.
	// Also pre-warm signed "play" URLs in the background so prompt-play works without autoplay blocks.
	useEffect(() => {
		const assets = collectAudioAssetsFromChats(chats);
		audioController.registerAssets(assets);

		let cancelled = false;

		(async () => {
			const newest = assets.slice(0, 12);
			if (newest.length === 0) return;

			const cache = signedUrlCacheRef.current;
			const now = Date.now();

			for (const a of newest) {
				if (!a.objectKey) continue;

				const cached = cache.get(a.objectKey);
				if (cached && cached.expiresAt > now + 60_000) {
					audioController.registerAssets([{ ...a, publicUrl: cached.url }]);
					continue;
				}

				try {
					const signed = await fetchSignedUrl(a.objectKey, "play");
					if (cancelled) return;

					cache.set(a.objectKey, signed);

					// Re-register with signed URL so play() can be synchronous later.
					audioController.registerAssets([{ ...a, publicUrl: signed.url }]);
				} catch {
					// ignore
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [chats]);

	useEffect(() => {
		setAutoTitleRequested(false);
	}, [chatId]);

	// Auto-resize textarea
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;

		el.style.height = "0px";
		el.style.height = el.scrollHeight + "px";
	}, [input]);

	// Close emoji picker on outside click / Esc, and focus search when opened.
	useEffect(() => {
		if (!emojiOpen) return;

		const onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === "Escape") setEmojiOpen(false);
		};

		const onMouseDown = (ev: MouseEvent) => {
			const t = ev.target as Node | null;
			if (!t) return;

			const panel = emojiPanelRef.current;
			const btn = emojiBtnRef.current;

			if (panel && panel.contains(t)) return;
			if (btn && btn.contains(t)) return;

			setEmojiOpen(false);
		};

		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("mousedown", onMouseDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("mousedown", onMouseDown);
		};
	}, [emojiOpen]);

	useEffect(() => {
		if (!emojiOpen) return;
		const id = window.setTimeout(() => {
			emojiSearchRef.current?.focus();
		}, 0);
		return () => window.clearTimeout(id);
	}, [emojiOpen]);

	// ---- Load messages for this chat from Neon when the chat opens / changes ----
	useEffect(() => {
		if (!chatId) return;

		// If UI prefetch already loaded messages (ids and/or attachments), skip.
		const currentChat = chats.find((c) => c.id === chatId);
		const msgs: any[] = Array.isArray((currentChat as any)?.messages)
			? ((currentChat as any).messages as any[])
			: [];

		const looksLoaded =
			msgs.some((m) => typeof (m as any)?.id === "string") ||
			msgs.some((m) => Array.isArray((m as any)?.attachments) && (m as any).attachments.length > 0);

		if (looksLoaded) return;

		// Prevent repeated fetch attempts for the same chatId
		if (fetchedChatIdsRef.current.has(chatId)) return;
		fetchedChatIdsRef.current.add(chatId);

		let cancelled = false;

		(async () => {
			try {
				const dbMessages = await fetchChatMessages(chatId);
				if (cancelled) return;

				setChats((prev) =>
					prev.map((c) =>
						c.id === chatId
							? {
									...c,
									messages: dbMessages.map((m) => {
										const attachments = Array.isArray(m.attachments)
											? m.attachments.map(normalizeAttachment)
											: undefined;

										const raw = (m.content ?? "") as string;

										const text =
											m.role === "assistant"
												? sanitizeEmDashesToSentences(stripYsToolTags(raw))
												: raw === ZWSP && attachments && attachments.length
												? uploadLabel(attachments)
												: raw;

										return {
											id: m.id,
											role: m.role,
											text,
											attachments,
											ts: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
										};
									}),
							  }
							: c
					)
				);
			} catch (e: any) {
				// allow retry if it failed (network, etc.)
				fetchedChatIdsRef.current.delete(chatId);

				if (e?.message === "chat_not_found") return;
				console.error("Failed to load messages for chat", chatId, e);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [chatId, chats, setChats]);

	// Keep scroll pinned to bottom when messages change
	useEffect(() => {
		const el = scrollerRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [chatId, messageCount]);

	// Auto-generate a short chat title once per chat (ChatGPT-style)
	useEffect(() => {
		const current = chats.find((c) => c.id === chatId);
		if (!current) return;

		if (current.title && current.title.trim().length > 0) return;

		const msgs = Array.isArray(current.messages) ? current.messages : [];
		const hasUser = msgs.some((m: any) => m.role === "user");
		const hasAssistant = msgs.some((m: any) => m.role === "assistant");
		if (!hasUser || !hasAssistant) return;

		if (autoTitleRequested) return;
		setAutoTitleRequested(true);

		(async () => {
			try {
				const snippet = msgs
					.slice(0, 8)
					.map((m: any) => {
						const speaker = m.role === "user" ? "User" : "Assistant";
						return `${speaker}: ${m.text}`;
					})
					.join("\n");

				const res = await fetch("https://api.ysong.ai/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						messages: [
							{
								role: "system",
								content:
									"You name chat conversations. Given a short transcript, respond with a very short title (3 to 6 words). No quotes, no emojis, no trailing period.",
							},
							{
								role: "user",
								content: "Write a concise title for this chat:\n\n" + snippet,
							},
						],
					}),
				});

				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				let title = (data?.reply ?? "").trim();

				title = title.replace(/^["']|["']$/g, "");
				if (title.length > 60) title = title.slice(0, 59) + "…";
				if (!title) return;

				setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));

				try {
					const token = localStorage.getItem("ys_token");
					if (token) {
						const renameUrl = API ? `${API}/api/chats/rename` : `/api/chats/rename`;

						await fetch(renameUrl, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${token}`,
							},
							body: JSON.stringify({ chatId, title }),
						});
					}
				} catch (err) {
					console.warn("Failed to persist chat title", err);
				}
			} catch (err) {
				console.error("Failed to auto-title chat", err);
			} finally {
				setAutoTitleRequested(false);
			}
		})();
	}, [chatId, chats, setChats, autoTitleRequested]);

	if (!chat) {
		return <div className="p-6 text-sm opacity-70">Chat not found. (It may have been deleted.)</div>;
	}

	function syncComposerSelection() {
		const el = textareaRef.current;
		if (!el) return;

		const start = typeof el.selectionStart === "number" ? el.selectionStart : el.value.length;
		const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;

		composerSelRef.current = { start, end };
	}

	function toggleEmojiPicker() {
		setEmojiOpen((v) => {
			const next = !v;
			if (next) {
				syncComposerSelection();
				setEmojiQuery("");
			}
			return next;
		});
	}

	function insertEmoji(ch: string) {
		const el = textareaRef.current;

		// If the textarea is not focused (because the user clicked an emoji),
		// use the last-known caret position.
		const sel =
			el && document.activeElement === el
				? {
						start: typeof el.selectionStart === "number" ? el.selectionStart : el.value.length,
						end:
							typeof el.selectionEnd === "number"
								? el.selectionEnd
								: typeof el.selectionStart === "number"
								? el.selectionStart
								: el.value.length,
				  }
				: composerSelRef.current;

		// If the picker gives "GB"/"US"/"CN", convert to the actual Unicode flag.
		const normalized = (ch ?? "").trim();
		const toInsert = /^[A-Za-z]{2}$/.test(normalized) ? isoCountryToFlagEmoji(normalized) : normalized;

		const caret = sel.start + toInsert.length;

		setInput((prev) => {
			const start = Math.max(0, Math.min(prev.length, sel.start));
			const end = Math.max(start, Math.min(prev.length, sel.end));
			return prev.slice(0, start) + toInsert + prev.slice(end);
		});

		requestAnimationFrame(() => {
			const t = textareaRef.current;
			if (!t) return;
			try {
				t.focus();
				t.setSelectionRange(caret, caret);
				composerSelRef.current = { start: caret, end: caret };
			} catch {
				// ignore
			}
		});
	}

	const emojiQueryTrim = emojiQuery.trim();
	const emojiList = emojiQueryTrim
		? EMOJI_INDEX.filter((e) => emojiMatchesQuery(e, emojiQueryTrim)).slice(0, 200)
		: EMOJI_BY_CAT[emojiCat] ?? EMOJI_BY_CAT.smileys;

	function triggerPicker() {
		fileInputRef.current?.click();
	}

	function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
		const files = Array.from(e.target.files ?? []);
		if (!files.length) return;

		const filtered = files.filter((f) => f.size <= 50 * 1024 * 1024);

		setPendingFiles((prev) => [...prev, ...filtered]);
		setProgressByKey((prev) => {
			const next = { ...prev };
			for (const f of filtered) next[fileKey(f)] = 0;
			return next;
		});

		e.currentTarget.value = "";
	}

	function removePending(i: number) {
		setPendingFiles((prev) => {
			const target = prev[i];
			const next = prev.filter((_, idx) => idx !== i);
			if (target) {
				const k = fileKey(target);
				setProgressByKey((p) => {
					const n = { ...p };
					delete n[k];
					return n;
				});
			}
			return next;
		});
	}

	async function uploadWithXHR(
		url: string,
		token: string,
		file: File,
		onProgress: (pct: number) => void
	): Promise<any> {
		return await new Promise((resolve, reject) => {
			const formData = new FormData();
			formData.append("file", file, file.name);

			const xhr = new XMLHttpRequest();
			xhr.open("POST", url, true);
			xhr.responseType = "json";
			xhr.setRequestHeader("Authorization", `Bearer ${token}`);

			xhr.upload.onprogress = (evt) => {
				if (!evt.lengthComputable) return;
				const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
				onProgress(pct);
			};

			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					resolve(xhr.response);
				} else {
					reject(new Error(`upload_failed_${xhr.status}`));
				}
			};

			xhr.onerror = () => reject(new Error("upload_network_error"));
			xhr.send(formData);
		});
	}

	async function uploadFiles(files: File[]): Promise<Attachment[]> {
		if (files.length === 0) return [];

		const token = localStorage.getItem("ys_token");
		if (!token) throw new Error("no_token");

		const url = API ? `${API}/api/uploads` : `/api/uploads`;

		const uploaded: Attachment[] = [];

		for (const file of files) {
			const k = fileKey(file);

			const json = await uploadWithXHR(url, token, file, (pct) => {
				setProgressByKey((prev) => ({ ...prev, [k]: pct }));
			});

			setProgressByKey((prev) => ({ ...prev, [k]: 100 }));

			uploaded.push({
				name: normalizeFilenameDisplay(json?.filename ?? file.name),
				size: json?.size ?? file.size,
				type: json?.contentType ?? file.type,
				publicUrl: json?.publicUrl,
				objectKey: json?.objectKey,
			});
		}

		return uploaded;
	}

	async function deleteUploadFromCloud(objectKey: string) {
		const token = localStorage.getItem("ys_token");
		if (!token) throw new Error("no_token");

		const url = API ? `${API}/api/uploads/delete` : `/api/uploads/delete`;

		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ objectKey }),
		});

		if (!res.ok) throw new Error(`delete_failed_${res.status}`);
	}

	async function deleteAssetEverywhere(objectKey: string) {
		if (!objectKey) return;

		// Snapshot which messages reference this objectKey (for server cleanup)
		const messageIds: string[] = [];
		try {
			for (const c of chats) {
				for (const msg of c.messages ?? []) {
					const atts = (msg as any).attachments ?? [];
					for (const raw of atts) {
						const a = normalizeAttachment(raw);
						if (a.objectKey === objectKey && (msg as any).id) {
							messageIds.push((msg as any).id as string);
							break;
						}
					}
				}
			}
		} catch {
			// non-fatal
		}

		try {
			// 1) Delete from GCS
			await deleteUploadFromCloud(objectKey);
		} catch (e) {
			console.error("Delete from cloud failed", e);
			// Still proceed with UI cleanup to avoid ghost pills,
			// but server attachments might remain if delete failed.
		}

		// 2) Remove from Neon attachments_json for any message that referenced it
		try {
			const token = localStorage.getItem("ys_token");
			const removeUrl = API ? `${API}/api/messages/remove-attachment` : `/api/messages/remove-attachment`;

			if (token && messageIds.length > 0) {
				await Promise.all(
					messageIds.map(async (messageId) => {
						try {
							const res = await fetch(removeUrl, {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									Authorization: `Bearer ${token}`,
								},
								body: JSON.stringify({ messageId, objectKey }),
							});

							if (!res.ok) {
								console.warn("remove-attachment failed", messageId, await res.text());
							}
						} catch (err) {
							console.warn("remove-attachment request failed", messageId, err);
						}
					})
				);
			}
		} catch (e) {
			console.warn("Failed to clear attachment in Neon", e);
		}

		// 3) Update UI everywhere (remove the pill from all chats/messages)
		setChats((prev) =>
			prev.map((c) => ({
				...c,
				messages: (c.messages ?? []).map((msg: any) => {
					const atts = msg.attachments ?? [];
					if (!Array.isArray(atts) || atts.length === 0) return msg;

					const nextAtt = atts.filter((raw: any) => normalizeAttachment(raw).objectKey !== objectKey);

					if (nextAtt.length === atts.length) return msg;

					return {
						...msg,
						attachments: nextAtt.length ? nextAtt : undefined,
					};
				}),
			}))
		);
	}

	async function send() {
		const current = chats.find((c) => c.id === chatId);
		if (!current) return;
		if (isUploading) return;
		if (!input.trim() && pendingFiles.length === 0) return;

		// Close emoji picker on send
		setEmojiOpen(false);
		setEmojiQuery("");

		const rawText = input;
		const text = rawText.trim();
		const hasText = text.length > 0;
		const filesToUpload = [...pendingFiles];

		// Audio assets (newest first) for prompt-control + LLM context.
		const audioAssets = collectAudioAssetsFromChats(chats);

		// If this message is a “pure audio command” (no uploads), we can execute locally
		// (the user experiences it as “AI via prompt” without UI changes).
		const localAudioActions =
			hasText && filesToUpload.length === 0 ? parseUserAudioCommands(text, audioAssets) : null;

		// Execute prompt-audio commands immediately (before awaits) to avoid
		// autoplay blocks, but still let the LLM generate the reply text.
		const preExecutedAudioActions = localAudioActions && localAudioActions.length > 0 ? localAudioActions : null;

		// Natural-feeling playback: we previously tried to "prime" audio muted and then resume
		// after the assistant reply. That introduces race conditions and can leave playback paused.
		// For locally-handled audio commands we should just play immediately so UI + audio stay in sync.
		let queuedResumeRef: AudioTargetRef | undefined;
		let resetToStartOnResume = false;

		const willReplyLocally = !!preExecutedAudioActions?.length;

		const deferAudibleUntilReply =
			!willReplyLocally &&
			(preExecutedAudioActions?.some((a) => a.kind === "play" || a.kind === "resume") ?? false);

		let shouldUnmuteAfterReply = false;

		if (deferAudibleUntilReply) {
			audioController.setMuted(true);
			shouldUnmuteAfterReply = true;
		}

		if (preExecutedAudioActions) {
			// Ensure the controller has the latest registry
			audioController.registerAssets(audioAssets);

			const snap = audioController.getSnapshot();
			const currentRef: AudioTargetRef | undefined = snap.currentId ? { id: snap.currentId } : undefined;

			for (const action of preExecutedAudioActions) {
				try {
					if (action.kind === "play") {
						const ref = action.ref;
						if (!ref) continue;
						void audioController.play(ref);
					} else if (action.kind === "resume") {
						const ref = action.ref;
						if (!ref) continue;
						void audioController.resume(ref);
					} else if (action.kind === "pause") {
						audioController.pause(action.ref ?? currentRef);
					} else if (action.kind === "stop") {
						audioController.stop(action.ref ?? currentRef);
					} else if (action.kind === "seekSeconds") {
						const ref = action.ref ?? currentRef;
						if (ref) audioController.seekSeconds(ref, action.seconds);
					} else if (action.kind === "seekFrac") {
						const ref = action.ref ?? currentRef;
						if (ref) audioController.seekFrac(ref, action.fraction);
					}
				} catch (err) {
					console.warn("Audio command failed", action, err);
				}
			}
		}

		const shouldCallAI = hasText && !preExecutedAudioActions;

		setInput("");

		let attachments: Attachment[] | undefined;

		try {
			if (filesToUpload.length > 0) {
				setIsUploading(true);
				const uploaded = await uploadFiles(filesToUpload);
				attachments = uploaded.length > 0 ? uploaded : undefined;
			}
		} catch (e) {
			console.error("Failed to upload files", e);
			setInput(rawText);
			return;
		} finally {
			setIsUploading(false);
		}

		// only clear pending chips after upload succeeds
		if (filesToUpload.length > 0) {
			setPendingFiles([]);
			setProgressByKey((prev) => {
				const next = { ...prev };
				for (const f of filesToUpload) delete next[fileKey(f)];
				return next;
			});
		}

		const typingToken = shouldCallAI ? `__typing_${globalThis.crypto.randomUUID()}__` : "";

		// optimistic UI: user message (+ typing bubble only if we will call AI)
		const userTs = Date.now();

		setChats((prev) =>
			prev.map((c) =>
				c.id === chatId
					? {
							...c,
							messages: [
								...(Array.isArray(c.messages) ? (c.messages as any[]) : []),
								{
									role: "user",
									text: hasText ? text : uploadLabel(attachments),
									attachments,
									ts: userTs,
								} as ChatMessage,
								...(shouldCallAI
									? ([
											{
												role: "assistant",
												text: "…",
												token: typingToken,
												ts: Date.now(),
											} as ChatMessage,
									  ] as ChatMessage[])
									: []),
							],
					  }
					: c
			)
		);

		// Persist + patch id back into the optimistic message
		try {
			const saved = await appendMessage(chatId, {
				role: "user",
				content: hasText ? text : ZWSP,
				attachments,
			});

			setChats((prev) =>
				prev.map((c) =>
					c.id === chatId
						? {
								...c,
								messages: (c.messages ?? []).map((m: any) =>
									m.role === "user" && m.ts === userTs ? { ...m, id: saved.id } : m
								),
						  }
						: c
				)
			);
		} catch (e) {
			console.error("Failed to save user message to Neon", e);
		}

		// File-only message: DO NOT auto-reply.
		// (User sees "Uploaded: ..." as their message; AI responds naturally only when the user also sends text.)
		if (!hasText) return;

		// If we already executed a local audio command, reply locally so the
		// visible assistant text always matches the exact track/action that ran.
		// This avoids the model "guessing" a title that differs from playback.
		if (preExecutedAudioActions?.length) {
			const localVisible = sanitizeEmDashesToSentences(
				stripAudioCommandHints(
					stripYsToolTags(fallbackAckForAudioActions(preExecutedAudioActions, audioAssets))
				)
			);

			try {
				await appendMessage(chatId, {
					role: "assistant",
					content: localVisible,
				});
			} catch (e) {
				console.error("Failed to save local assistant reply to Neon", e);
			}

			setChats((prev) =>
				prev.map((c) =>
					c.id === chatId
						? {
								...c,
								messages: [
									...(Array.isArray(c.messages) ? (c.messages as any[]) : []),
									{
										role: "assistant",
										text: localVisible,
										ts: Date.now(),
									} as ChatMessage,
								],
						  }
						: c
				)
			);

			if (shouldUnmuteAfterReply) {
				try {
					audioController.setMuted(false);
					if (queuedResumeRef) {
						if (resetToStartOnResume) {
							audioController.seekSeconds(queuedResumeRef, 0);
						}
						void audioController.resume(queuedResumeRef);
					}
				} catch {
					// ignore
				}
			}

			return;
		}

		// ---- LLM path ----
		try {
			const baseMsgs = (current.messages ?? []).map((m: any) => ({
				role: m.role,
				content: typeof m.text === "string" && m.text.trim().length ? m.text : ZWSP,
			}));

			const audioToolMsg = buildAudioToolSystemMessage(audioAssets);

			const alreadyHandledMsg = preExecutedAudioActions
				? `Playback note: the user's audio request was already executed by the app.
${summarizeLocalAudioActions(preExecutedAudioActions, audioAssets)}
- Do NOT emit any [[ys:audio.*]] tool tags.
- Do NOT ask the user to type a command or a filename.
- Keep the reply short, conversational, and avoid file extensions.
- Stay in your current in-chat persona/voice (do not become robotic). Vary phrasing for play/pause/stop/seek acknowledgements.`
				: "";

			const res = await fetch("https://api.ysong.ai/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: [
						{ role: "system", content: audioToolMsg },
						...(alreadyHandledMsg ? [{ role: "system", content: alreadyHandledMsg }] : []),
						...baseMsgs,
						{ role: "user", content: text },
					],
				}),
			});

			if (!res.ok) throw new Error(`ai_failed_${res.status}`);
			const data = await res.json();

			const rawReply = redactAssetSecrets(data?.reply ?? "…");

			// Execute any audio tool tags the model emitted, then strip them from the visible reply.
			const { cleaned, actions } = extractAudioToolTags(rawReply);

			const shouldRunToolTags = !preExecutedAudioActions;

			if (shouldRunToolTags && actions.length > 0) {
				for (const action of actions) {
					try {
						if (action.kind === "play") await audioController.play(action.ref);
						else if (action.kind === "resume") await audioController.resume(action.ref);
						else if (action.kind === "pause") audioController.pause(action.ref);
						else if (action.kind === "stop") audioController.stop(action.ref);
						else if (action.kind === "seekSeconds") {
							const ref =
								action.ref ??
								(audioController.getSnapshot().currentId
									? {
											id: audioController.getSnapshot().currentId!,
									  }
									: undefined);
							if (ref) audioController.seekSeconds(ref, action.seconds);
						} else if (action.kind === "seekFrac") {
							const ref =
								action.ref ??
								(audioController.getSnapshot().currentId
									? {
											id: audioController.getSnapshot().currentId!,
									  }
									: undefined);
							if (ref) audioController.seekFrac(ref, action.fraction);
						}
					} catch (err) {
						console.warn("Audio tool tag failed", action, err);
					}
				}
			}

			let rawVisible = stripYsToolTags(
				cleaned || (actions.length ? fallbackAckForAudioActions(actions, audioAssets) : "…")
			);
			if (preExecutedAudioActions?.length) {
				rawVisible = stripAudioCommandHints(rawVisible);
			}
			const reply = sanitizeEmDashesToSentences(rawVisible);

			try {
				await appendMessage(chatId, {
					role: "assistant",
					content: reply,
				});
			} catch (e) {
				console.error("Failed to save assistant message to Neon", e);
			}

			setChats((prev) =>
				prev.map((c) =>
					c.id === chatId
						? {
								...c,
								messages: (c.messages ?? []).map((m: any) =>
									m.token === typingToken
										? {
												role: "assistant",
												text: reply,
												ts: Date.now(),
										  }
										: m
								),
						  }
						: c
				)
			);

			if (shouldUnmuteAfterReply) {
				try {
					if (queuedResumeRef) {
						if (resetToStartOnResume) {
							audioController.seekSeconds(queuedResumeRef, 0);
						}
						audioController.setMuted(false);
						void audioController.resume(queuedResumeRef);
					} else {
						audioController.setMuted(false);
					}
				} catch {
					// ignore
				}
			}
		} catch (e) {
			console.error("Chat send failed", e);

			setChats((prev) =>
				prev.map((c) =>
					c.id === chatId
						? {
								...c,
								messages: (c.messages ?? []).map((m: any) =>
									m.token === typingToken
										? {
												role: "assistant",
												text: "⚠️ Failed to get a reply.",
												ts: Date.now(),
										  }
										: m
								),
						  }
						: c
				)
			);

			// Don't leave the app muted if the model call failed.
			if (shouldUnmuteAfterReply) {
				try {
					if (queuedResumeRef) {
						if (resetToStartOnResume) {
							audioController.seekSeconds(queuedResumeRef, 0);
						}
						audioController.setMuted(false);
						void audioController.resume(queuedResumeRef);
					} else {
						audioController.setMuted(false);
					}
				} catch {
					// ignore
				}
			}
		}
	}

	return (
		<div className="h-full flex flex-col">
			{/* messages */}
			<div
				ref={scrollerRef}
				className="flex-1 min-h-0 overflow-y-auto"
				style={{ scrollbarGutter: "stable both-edges" } as any}
			>
				<div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-6 pb-4">
					<div className="flex flex-col gap-4">
						{(Array.isArray(chat.messages) ? (chat.messages as unknown as ChatMessage[]) : []).map(
							(m, i) => (
								<div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
									<div
										className={`flex flex-col w-full ${
											m.role === "user" ? "items-end" : "items-start"
										}`}
									>
										<div
											className={`rounded-2xl px-4 py-3 leading-relaxed shadow-sm whitespace-pre-wrap
                      ${
							m.role === "user"
								? "bg-neutral-700 text-white dark:bg-neutral-800"
								: "bg-neutral-100 dark:bg-neutral-900"
						}
                      max-w-[85%] sm:max-w-[70%]`}
										>
											{renderTwemojiFlags(
												m.role === "assistant" ? stripYsToolTags(m.text) : m.text
											)}
											{m.attachments && m.attachments.length > 0 && (
												<div className="mt-3 flex flex-wrap gap-3">
													{m.attachments.map((att, j) => {
														const a = normalizeAttachment(att);

														const sizeMB =
															typeof a.size === "number"
																? Number((a.size / (1024 * 1024)).toFixed(1))
																: 0;

														const pillType =
															typeof a.type === "string" &&
															a.type.toLowerCase().startsWith("audio")
																? "audio"
																: "file";

														const stableId =
															a.objectKey ?? a.publicUrl ?? `${a.name}:${a.size}`;

														const ok = a.objectKey;

														return (
															<FilePill
																key={`${m.id ?? i}-${j}-${stableId}`}
																id={stableId}
																name={a.name}
																sizeMB={sizeMB}
																type={pillType as any}
																publicUrl={a.publicUrl}
																objectKey={a.objectKey}
																onDelete={
																	ok ? () => deleteAssetEverywhere(ok) : undefined
																}
															/>
														);
													})}
												</div>
											)}
										</div>

										{showTimestamps && m.ts != null && (
											<div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
												<time
													dateTime={new Date(m.ts).toISOString()}
													title={new Date(m.ts).toLocaleString()}
												>
													{formatTime(m.ts)}
												</time>
											</div>
										)}
									</div>
								</div>
							)
						)}

						<div ref={bottomRef} />
					</div>
				</div>
			</div>

			{/* composer */}
			<div className="border-t border-neutral-200 dark:border-neutral-800">
				{/* Pending uploads */}
				{pendingFiles.length > 0 && (
					<div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pt-3 flex flex-wrap gap-3">
						{pendingFiles.map((f, idx) => {
							const isAudio = f.type.startsWith("audio/");
							const totalMB = f.size / (1024 * 1024);
							const pct = progressByKey[fileKey(f)] ?? 0;
							const loadedMB = totalMB * (pct / 100);

							return (
								<div
									key={idx}
									className="w-[200px] max-w-[200px] flex items-center gap-3 rounded-2xl border border-neutral-300 bg-neutral-50/90 px-3 py-2 text-xs sm:text-sm shadow-sm
                    dark:border-neutral-700 dark:bg-neutral-900/70"
								>
									<div className="flex flex-col items-center justify-center">
										<div className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-50">
											{isUploading ? (
												<div className="h-4 w-4 rounded-full border-2 border-neutral-500/70 border-t-transparent animate-spin" />
											) : isAudio ? (
												"🎵"
											) : (
												"📎"
											)}
										</div>

										{isAudio && (
											<div className="mt-1 flex h-4 items-end gap-[2px] text-[0]">
												{Array.from({ length: 12 }).map((_, barIdx) => (
													<span
														key={barIdx}
														className="flex-1 rounded-full bg-neutral-400/80 dark:bg-neutral-500/80"
														style={{
															height: `${4 + ((barIdx * 7) % 10)}px`,
														}}
													/>
												))}
											</div>
										)}
									</div>

									<div className="min-w-0 flex flex-col flex-1">
										<span className="truncate max-w-[10rem] font-medium">
											{normalizeFilenameDisplay(f.name)}
										</span>

										{isUploading ? (
											<>
												{/* shorter line so it won’t wrap */}
												<span className="mt-0.5 text-[9px] leading-none tracking-tight opacity-70 whitespace-nowrap">
													{loadedMB.toFixed(1)}/{totalMB.toFixed(1)} MB · {pct}%
												</span>

												<div className="mt-1 h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
													<div
														className="h-full rounded-full bg-neutral-500 dark:bg-neutral-400"
														style={{
															width: `${pct}%`,
														}}
													/>
												</div>
											</>
										) : (
											<span className="mt-0.5 text-[10px] uppercase tracking-wide opacity-70 whitespace-nowrap">
												{isAudio ? "Audio file" : "Attachment"} · {fmtMB(f.size)}
											</span>
										)}
									</div>

									<YSButton
										type="button"
										onClick={() => removePending(idx)}
										disabled={isUploading}
										className="ml-1 rounded-full px-2 text-xs opacity-60 hover:bg-neutral-200 hover:opacity-100 dark:hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed"
										aria-label={`Remove ${f.name}`}
										title="Remove"
									>
										✕
									</YSButton>
								</div>
							);
						})}
					</div>
				)}

				{/* Main input bar */}
				<div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 py-4 pb-[env(safe-area-inset-bottom)] mb-10">
					<div className="flex items-center">
						<label htmlFor={`filePicker-${chatId}`} className="sr-only">
							Add files
						</label>

						<div className="relative flex w-full items-center gap-1 rounded-2xl border border-neutral-300 bg-neutral-50/80 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900/60">
							<YSButton
								type="button"
								onClick={triggerPicker}
								disabled={isUploading}
								className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-transparent text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed"
								title="Add files"
								aria-label="Add files"
							>
								+
							</YSButton>

							<input
								id={`filePicker-${chatId}`}
								name="files"
								disabled={isUploading}
								ref={fileInputRef}
								type="file"
								multiple
								onChange={onPickFiles}
								accept="audio/*,image/*,.txt,.md,.lrc,.lyr,.rtf,.json"
								className="hidden"
							/>

							<textarea
								id={`chat-input-${chatId}`}
								name="message"
								ref={textareaRef}
								value={input}
								rows={1}
								autoComplete="off"
								onChange={(e) => {
									setInput(e.target.value);
									requestAnimationFrame(syncComposerSelection);
								}}
								onSelect={syncComposerSelection}
								onKeyUp={syncComposerSelection}
								onMouseUp={syncComposerSelection}
								onFocus={syncComposerSelection}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										send();
									}
								}}
								placeholder={`Message ${import.meta.env.VITE_APP_NAME}…`}
								style={{
									fontFamily:
										'"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
								}}
								className="flex-1 bg-transparent border-0 px-2 py-1 text-sm sm:text-base
                  leading-relaxed resize-none overflow-y-auto max-h-40
                  focus:outline-none focus:ring-0"
							/>

							{/* Emoji (desktop-only) */}
							<div className="relative hidden sm:block">
								<button
									ref={emojiBtnRef}
									type="button"
									onClick={toggleEmojiPicker}
									className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-transparent text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-900
                  dark:text-neutral-500 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-50"
									title="Emoji"
									aria-label="Emoji"
								>
									<svg
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="h-5 w-5"
										aria-hidden="true"
									>
										<circle cx="12" cy="12" r="9" />
										<path d="M8.5 14.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5" />
										<path d="M9 10h.01" />
										<path d="M15 10h.01" />
									</svg>
								</button>

								{emojiOpen && (
									<div
										ref={emojiPanelRef}
										className="absolute bottom-11 right-0 z-50 w-[340px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg
                      dark:border-neutral-700 dark:bg-neutral-950"
										role="dialog"
										aria-label="Emoji picker"
									>
										<div className="p-2">
											<input
												ref={emojiSearchRef}
												value={emojiQuery}
												onChange={(e) => setEmojiQuery(e.target.value)}
												placeholder="Search emojis"
												className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm
                          focus:outline-none focus:ring-2 focus:ring-neutral-300
                          dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-neutral-700"
											/>
										</div>

										<div className="px-2 pb-2">
											<div className="flex items-center gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
												{EMOJI_CATEGORIES.map((cat) => (
													<button
														key={cat.key}
														type="button"
														onClick={() => {
															setEmojiCat(cat.key);
															setEmojiQuery("");
														}}
														className={`inline-flex h-8 w-8 items-center justify-center rounded-xl text-lg
                                  ${
										emojiCat === cat.key && !emojiQueryTrim
											? "bg-neutral-200 dark:bg-neutral-800"
											: "hover:bg-neutral-200/70 dark:hover:bg-neutral-800/70"
									}`}
														title={cat.label}
														aria-label={cat.label}
													>
														<span aria-hidden="true">{cat.icon}</span>
													</button>
												))}
											</div>

											<div className="mt-2 max-h-[260px] overflow-y-auto pr-1">
												<div className="grid grid-cols-10 gap-1">
													{emojiList.length ? (
														emojiList.map((e) => (
															<button
																key={`${e.cat}-${e.name}-${e.ch}`}
																type="button"
																onClick={() => {
																	const isIsoFlag =
																		e.cat === "flags" && /^[A-Za-z]{2}$/.test(e.ch);
																	const chToInsert = isIsoFlag
																		? isoCountryToFlagEmoji(e.ch)
																		: e.ch;

																	insertEmoji(chToInsert);
																	setEmojiOpen(false);
																}}
																className="inline-flex h-8 w-8 items-center justify-center rounded-xl hover:bg-neutral-200/70
                                          dark:hover:bg-neutral-800/70"
																title={`:${e.name}:`}
																aria-label={e.name}
															>
																{isRegionalIndicatorFlag(e.ch) ? (
																	<img
																		src={twemojiSvgUrl(e.ch)}
																		alt=""
																		className="h-6 w-6"
																		draggable={false}
																		loading="lazy"
																	/>
																) : (
																	<span className="text-lg leading-none">{e.ch}</span>
																)}
															</button>
														))
													) : (
														<div className="col-span-10 py-6 text-center text-sm opacity-70">
															No results
														</div>
													)}
												</div>
											</div>
										</div>
									</div>
								)}
							</div>

							<YSButton
								type="button"
								onClick={send}
								disabled={isUploading || (!input.trim() && pendingFiles.length === 0)}
								className="inline-flex h-8 items-center justify-center rounded-xl px-3 text-sm font-medium bg-neutral-900 text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
							>
								Send
							</YSButton>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ---------- Settings integration ---------- */
function useShowTimestamps() {
	const [flag, setFlag] = useState<boolean>(() => {
		if (typeof window !== "undefined" && (window as any).__YS_SETTINGS) {
			return !!(window as any).__YS_SETTINGS.showTimestamps;
		}
		return true;
	});

	useEffect(() => {
		const onSettings = (ev: Event) => {
			if (!(ev instanceof CustomEvent)) return;
			const detail: any = ev.detail || {};
			if (typeof detail.showTimestamps === "boolean") {
				setFlag(detail.showTimestamps);
			}
		};

		window.addEventListener("ysong:settings", onSettings);
		return () => {
			window.removeEventListener("ysong:settings", onSettings);
		};
	}, []);

	return flag;
}

/* ---------- Helpers ---------- */
function formatTime(input: number) {
	const d = new Date(input);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
