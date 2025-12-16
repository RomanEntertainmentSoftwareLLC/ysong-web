import { useEffect, useRef, useState } from "react";
import type { TabRecord } from "./core";
import type { Chat } from "../components/UISidebar";
import { fetchChatMessages, appendMessage } from "../lib/chatApi";
import { YSONG_SYSTEM_PROMPT } from "../lib/ysongPersona";
import { YSButton } from "../components/YSButton";
import { FilePill } from "../components/FilePill";
import {
    audioController,
    type AudioAsset,
    type AudioTargetRef,
} from "../components/AudioController";

const env = (import.meta as any).env || {};
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

    const url = API
        ? `${API}/api/uploads/signed-url`
        : `/api/uploads/signed-url`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ objectKey, mode }),
    });

    if (!res.ok) throw new Error(`signed_url_failed_${res.status}`);

    const data = await res.json();

    const signed =
        typeof data?.url === "string"
            ? data.url
            : typeof data?.signedUrl === "string"
            ? data.signedUrl
            : "";

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
        return { name: raw, size: 0, type: "" };
    }

    const name =
        typeof raw?.name === "string"
            ? raw.name
            : typeof raw?.filename === "string"
            ? raw.filename
            : "Unknown file";

    const size =
        typeof raw?.size === "number"
            ? raw.size
            : typeof raw?.bytes === "number"
            ? raw.bytes
            : 0;

    const type =
        typeof raw?.type === "string"
            ? raw.type
            : typeof raw?.contentType === "string"
            ? raw.contentType
            : "";

    // accept legacy keys too
    const publicUrl =
        raw?.publicUrl ??
        raw?.public_url ??
        raw?.url ??
        raw?.publicURL ??
        undefined;

    let objectKey =
        raw?.objectKey ??
        raw?.object_key ??
        raw?.gcsObjectKey ??
        raw?.gcs_key ??
        undefined;

    // if we only have the GCS url, derive objectKey from it
    if (!objectKey) objectKey = deriveObjectKeyFromPublicUrl(publicUrl);

    return { name, size, type, publicUrl, objectKey };
}

function sanitizeEmDashesToSentences(text: string): string {
    if (!text) return text;

    let out = text;

    // Case 1: middle-of-sentence clause, like "nice — this feels..."
    // Turn: "<char><spaces>—<spaces><letter>" into "<char>. <CapitalLetter>"
    out = out.replace(/(\S)\s*\u2014\s*([A-Za-z])/g, (_m, before, after) => {
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
    out = out.replace(
        /https?:\/\/storage\.googleapis\.com\/[\w\-./%?=&]+/g,
        "[redacted-url]"
    );
    out = out.replace(
        /https?:\/\/[\w\-]+\.storage\.googleapis\.com\/[\w\-./%?=&]+/g,
        "[redacted-url]"
    );

    // Tidy up extra blank lines caused by removals
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

function uploadAck(atts?: Attachment[]) {
    const list = Array.isArray(atts) ? atts : [];
    if (list.length === 0) return "Got it.";

    if (list.length === 1) {
        const a = list[0];
        return `Got it. I received your file: ${a.name} (${fmtMB(
            a.size
        )}). Tell me what you want to do with it and I will help.`;
    }

    const names = list.map((a) => a.name).join(", ");
    return `Got it. I received ${list.length} files: ${names}. Tell me what you want to do with them and I will help.`;
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

function collectAudioAssetsFromChats(
    allChats: Chat[],
    limit = 250
): AudioAsset[] {
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

                const id =
                    a.objectKey ??
                    a.publicUrl ??
                    (m.id ? `${m.id}:${a.name}` : `${a.name}:${a.size}`);

                if (seen.has(id)) continue;
                seen.add(id);

                out.push({
                    id,
                    name: a.name,
                    type: a.type,
                    size: a.size,
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
    return (s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/["'`]/g, "");
}

function bestMatchAsset(query: string | undefined, assets: AudioAsset[]) {
    if (!assets.length) return;

    const q = normalizeName(query || "");
    if (!q || q === "last" || q === "latest" || q === "current") {
        return assets[0]; // newest first
    }

    // Exact (case-insensitive) filename match.
    const exact = assets.find((a) => normalizeName(a.name) === q);
    if (exact) return exact;

    // Match without extension (e.g. “drums” matches “drums.wav”)
    const qNoExt = q.replace(/\.[a-z0-9]+$/i, "");
    const noExtExact = assets.find(
        (a) => normalizeName(a.name).replace(/\.[a-z0-9]+$/i, "") === qNoExt
    );
    if (noExtExact) return noExtExact;

    // Substring match (unique only)
    const hits = assets.filter((a) => normalizeName(a.name).includes(q));
    if (hits.length === 1) return hits[0];

    const hits2 = assets.filter((a) =>
        normalizeName(a.name)
            .replace(/\.[a-z0-9]+$/i, "")
            .includes(qNoExt)
    );
    if (hits2.length === 1) return hits2[0];

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
        if (
            Number.isNaN(a) ||
            Number.isNaN(b) ||
            (c != null && Number.isNaN(c))
        )
            return;
        return c == null ? a * 60 + b : a * 3600 + b * 60 + c;
    }

    // 1m30s, 2m, 45s, 1.5m
    const mmss = s.match(
        /^(?:(\d+(?:\.\d+)?)\s*h\s*)?(?:(\d+(?:\.\d+)?)\s*m\s*)?(?:(\d+(?:\.\d+)?)\s*s\s*)?$/
    );
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

function parseUserAudioCommands(
    textRaw: string,
    audioAssets: AudioAsset[]
): AudioAction[] | null {
    const t = (textRaw ?? "").trim();
    if (!t) return null;

    // Natural phrasing support:
    // "play X", "could you play X", "please play X", "can you pause", "seek 1:23", etc.
    const headRe =
        /^\s*(?:(?:ok|okay|alright|all right|hey|yo|pls|please|could you|can you|would you|would ya|can ya)\s+)*\b(play|resume|pause|stop|seek)\b/i;
    const m = t.match(headRe);
    if (!m) return null;

    const verb = String(m[1]).toLowerCase() as
        | "play"
        | "resume"
        | "pause"
        | "stop"
        | "seek";

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
            .replace(
                /\b(?:for\s+me|please|pls|now|right\s+now|thanks|thank\s+you)\b/gi,
                ""
            )
            .replace(
                /^(?:me\s+)?(?:some\s+of\s+that|some|of|that|this|the|a|an)\b\s*/i,
                ""
            )
            .replace(/\s{2,}/g, " ")
            .trim();

    // If they quote a filename, prefer it.
    const quoted = t.match(/["'`]\s*([^"'`]+?)\s*["'`]/)?.[1];

    if (verb === "pause") return [{ kind: "pause" }];
    if (verb === "stop") return [{ kind: "stop" }];

    if (verb === "play" || verb === "resume") {
        const query = stripFiller(quoted ?? tailRaw);
        const asset =
            bestMatchAsset(query || "last", audioAssets) ?? newest ?? undefined;
        if (!asset) return null;
        return [{ kind: verb, ref: refFromAsset(asset)! }];
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
                const asset = query
                    ? bestMatchAsset(query, audioAssets)
                    : undefined;
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
            const asset = query
                ? bestMatchAsset(query, audioAssets)
                : undefined;
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

    const tagRe =
        /\[\[ys:audio\.(play|resume|pause|stop|seek)\s*([^\]]*)\]\]/gi;

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
                    const useRef =
                        ref.id || ref.objectKey || ref.publicUrl
                            ? ref
                            : { id: currentId };
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
                const useRef =
                    ref.id || ref.objectKey || ref.publicUrl
                        ? ref
                        : { id: currentId };
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

function buildAudioToolSystemMessage(
    audioAssets: Array<{ id: string; name: string }>
) {
    const list = audioAssets
        .slice(0, 50)
        .map((a) => `- ${a.name} (id: ${a.id})`)
        .join("\n");

    return `
	AUDIO CONTROL (IN-APP)
	You can control playback by emitting tool tags. Do NOT print internal object keys or URLs in normal chat replies.

	Available audio assets (newest first):
	${list || "(none)"}

	Tool tags:
	[[ys:audio.play id="..."]]
	[[ys:audio.pause]]
	[[ys:audio.stop]]
	[[ys:audio.seek id="..." seconds="42"]]
	[[ys:audio.seek id="..." percent="0.5"]]
	[[ys:audio.download id="..."]]
	`.trim();
}

export default function ChatPane({ tab, chats, setChats }: Props) {
    const showTimestamps = useShowTimestamps();
    const chatId = tab.payload?.chatId as string;
    const chat = chats.find((c) => c.id === chatId);
    const messageCount = chat?.messages?.length ?? 0;

    const [input, setInput] = useState("");

    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [progressByKey, setProgressByKey] = useState<Record<string, number>>(
        {}
    );

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const signedUrlCacheRef = useRef<
        Map<string, { url: string; expiresAt: number }>
    >(new Map());

    const [autoTitleRequested, setAutoTitleRequested] = useState(false);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

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
                    audioController.registerAssets([
                        { ...a, publicUrl: cached.url },
                    ]);
                    continue;
                }

                try {
                    const signed = await fetchSignedUrl(a.objectKey, "play");
                    if (cancelled) return;

                    cache.set(a.objectKey, signed);

                    // Re-register with signed URL so play() can be synchronous later.
                    audioController.registerAssets([
                        { ...a, publicUrl: signed.url },
                    ]);
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

    // ---- Load messages for this chat from Neon when the chat opens / changes ----
    useEffect(() => {
        if (!chatId) return;
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
                                      const attachments = Array.isArray(
                                          m.attachments
                                      )
                                          ? m.attachments.map(
                                                normalizeAttachment
                                            )
                                          : undefined;

                                      const raw = (m.content ?? "") as string;

                                      const text =
                                          m.role === "assistant"
                                              ? sanitizeEmDashesToSentences(raw)
                                              : raw === ZWSP &&
                                                attachments &&
                                                attachments.length
                                              ? uploadLabel(attachments)
                                              : raw;

                                      return {
                                          id: m.id,
                                          role: m.role,
                                          text,
                                          attachments,
                                          ts: m.createdAt
                                              ? new Date(m.createdAt).getTime()
                                              : Date.now(),
                                      };
                                  }),
                              }
                            : c
                    )
                );
            } catch (e: any) {
                if (e?.message === "chat_not_found") return;
                console.error("Failed to load messages for chat", chatId, e);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [chatId, setChats]);

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
                        const speaker =
                            m.role === "user" ? "User" : "Assistant";
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
                                content:
                                    "Write a concise title for this chat:\n\n" +
                                    snippet,
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

                setChats((prev) =>
                    prev.map((c) => (c.id === chatId ? { ...c, title } : c))
                );

                try {
                    const token = localStorage.getItem("ys_token");
                    if (token) {
                        const renameUrl = API
                            ? `${API}/api/chats/rename`
                            : `/api/chats/rename`;

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
        return (
            <div className="p-6 text-sm opacity-70">
                Chat not found. (It may have been deleted.)
            </div>
        );
    }

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
                const pct = Math.max(
                    0,
                    Math.min(100, Math.round((evt.loaded / evt.total) * 100))
                );
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
                name: json?.filename ?? file.name,
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
            const removeUrl = API
                ? `${API}/api/messages/remove-attachment`
                : `/api/messages/remove-attachment`;

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
                                console.warn(
                                    "remove-attachment failed",
                                    messageId,
                                    await res.text()
                                );
                            }
                        } catch (err) {
                            console.warn(
                                "remove-attachment request failed",
                                messageId,
                                err
                            );
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

                    const nextAtt = atts.filter(
                        (raw: any) =>
                            normalizeAttachment(raw).objectKey !== objectKey
                    );

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

        const rawText = input;
        const text = rawText.trim();
        const hasText = text.length > 0;
        const filesToUpload = [...pendingFiles];

        // Audio assets (newest first) for prompt-control + LLM context.
        const audioAssets = collectAudioAssetsFromChats(chats);

        // If this message is a “pure audio command” (no uploads), we can execute locally
        // (the user experiences it as “AI via prompt” without UI changes).
        const localAudioActions =
            hasText && filesToUpload.length === 0
                ? parseUserAudioCommands(text, audioAssets)
                : null;

        // ---- Local audio command path (no LLM call) ----
        // Execute play/resume immediately (before awaits) to avoid autoplay blocks.
        if (localAudioActions && localAudioActions.length > 0) {
            setInput("");

            // Ensure the controller has the latest registry
            audioController.registerAssets(audioAssets);

            const snap = audioController.getSnapshot();
            const currentRef: AudioTargetRef | undefined = snap.currentId
                ? { id: snap.currentId }
                : undefined;

            const ackParts: string[] = [];

            for (const action of localAudioActions) {
                try {
                    if (action.kind === "play") {
                        const a = audioController.getAsset(action.ref);
                        ackParts.push(
                            `Playing "${
                                a?.name ?? action.ref.name ?? "audio"
                            }".`
                        );
                        void audioController.play(action.ref);
                    } else if (action.kind === "resume") {
                        const a = audioController.getAsset(action.ref);
                        ackParts.push(
                            `Resuming "${
                                a?.name ?? action.ref.name ?? "audio"
                            }".`
                        );
                        void audioController.resume(action.ref);
                    } else if (action.kind === "pause") {
                        ackParts.push("Paused.");
                        audioController.pause(action.ref ?? currentRef);
                    } else if (action.kind === "stop") {
                        ackParts.push("Stopped.");
                        audioController.stop(action.ref ?? currentRef);
                    } else if (action.kind === "seekSeconds") {
                        const ref = action.ref ?? currentRef;
                        if (!ref) {
                            ackParts.push("No track is currently selected.");
                        } else {
                            ackParts.push(
                                `Seeking to ${Math.round(action.seconds)}s.`
                            );
                            audioController.seekSeconds(ref, action.seconds);
                        }
                    } else if (action.kind === "seekFrac") {
                        const ref = action.ref ?? currentRef;
                        if (!ref) {
                            ackParts.push("No track is currently selected.");
                        } else {
                            ackParts.push(
                                `Seeking to ${Math.round(
                                    action.fraction * 100
                                )}%.`
                            );
                            audioController.seekFrac(ref, action.fraction);
                        }
                    }
                } catch (err) {
                    console.warn("Audio command failed", action, err);
                    ackParts.push("Audio command failed.");
                }
            }

            const assistantText = ackParts.join(" ") || "Done.";
            const userTs = Date.now();

            // Write the user line and the acknowledgement to the chat immediately.
            setChats((prev) =>
                prev.map((c) =>
                    c.id === chatId
                        ? {
                              ...c,
                              messages: [
                                  ...(c.messages ?? []),
                                  {
                                      role: "user",
                                      text,
                                      ts: userTs,
                                  } as ChatMessage,
                                  {
                                      role: "assistant",
                                      text: assistantText,
                                      ts: Date.now(),
                                  } as ChatMessage,
                              ],
                          }
                        : c
                )
            );

            // Persist best-effort (after audio already started)
            (async () => {
                try {
                    await appendMessage(chatId, {
                        role: "user",
                        content: text,
                    });
                    await appendMessage(chatId, {
                        role: "assistant",
                        content: assistantText,
                    });
                } catch (e) {
                    console.error(
                        "Failed to persist audio command messages",
                        e
                    );
                }
            })();

            return;
        }

        const shouldCallAI = hasText && !localAudioActions;

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

        const typingToken = shouldCallAI
            ? `__typing_${globalThis.crypto.randomUUID()}__`
            : "";

        // optimistic UI: user message (+ typing bubble only if we will call AI)
        const userTs = Date.now();

        setChats((prev) =>
            prev.map((c) =>
                c.id === chatId
                    ? {
                          ...c,
                          messages: [
                              ...(Array.isArray(c.messages)
                                  ? (c.messages as any[])
                                  : []),
                              {
                                  role: "user",
                                  text: hasText
                                      ? text
                                      : uploadLabel(attachments),
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
                                  m.role === "user" && m.ts === userTs
                                      ? { ...m, id: saved.id }
                                      : m
                              ),
                          }
                        : c
                )
            );
        } catch (e) {
            console.error("Failed to save user message to Neon", e);
        }

        // file-only message: still respond (local ack) so the user gets feedback.
        // We intentionally do NOT call the AI here because the current chat API
        // does not send/stream file contents to the model.
        if (!hasText) {
            const ack = uploadAck(attachments);
            const ackTs = Date.now();

            setChats((prev) =>
                prev.map((c) =>
                    c.id === chatId
                        ? {
                              ...c,
                              messages: [
                                  ...(c.messages ?? []),
                                  {
                                      role: "assistant",
                                      text: ack,
                                      ts: ackTs,
                                  } as ChatMessage,
                              ],
                          }
                        : c
                )
            );

            try {
                await appendMessage(chatId, {
                    role: "assistant",
                    content: ack,
                });
            } catch (e) {
                console.error("Failed to save upload ack to Neon", e);
            }

            return;
        }

        // ---- LLM path ----
        try {
            const baseMsgs = (current.messages ?? []).map((m: any) => ({
                role: m.role,
                content:
                    typeof m.text === "string" && m.text.trim().length
                        ? m.text
                        : ZWSP,
            }));

            const audioToolMsg = buildAudioToolSystemMessage(audioAssets);

            const res = await fetch("https://api.ysong.ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [
                        { role: "system", content: YSONG_SYSTEM_PROMPT },
                        { role: "system", content: audioToolMsg },
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

            if (actions.length > 0) {
                for (const action of actions) {
                    try {
                        if (action.kind === "play")
                            await audioController.play(action.ref);
                        else if (action.kind === "resume")
                            await audioController.resume(action.ref);
                        else if (action.kind === "pause")
                            audioController.pause(action.ref);
                        else if (action.kind === "stop")
                            audioController.stop(action.ref);
                        else if (action.kind === "seekSeconds") {
                            const ref =
                                action.ref ??
                                (audioController.getSnapshot().currentId
                                    ? {
                                          id: audioController.getSnapshot()
                                              .currentId!,
                                      }
                                    : undefined);
                            if (ref)
                                audioController.seekSeconds(
                                    ref,
                                    action.seconds
                                );
                        } else if (action.kind === "seekFrac") {
                            const ref =
                                action.ref ??
                                (audioController.getSnapshot().currentId
                                    ? {
                                          id: audioController.getSnapshot()
                                              .currentId!,
                                      }
                                    : undefined);
                            if (ref)
                                audioController.seekFrac(ref, action.fraction);
                        }
                    } catch (err) {
                        console.warn("Audio tool tag failed", action, err);
                    }
                }
            }

            const rawVisible = cleaned || (actions.length ? "Done." : "…");
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
                        {(Array.isArray(chat.messages)
                            ? (chat.messages as unknown as ChatMessage[])
                            : []
                        ).map((m, i) => (
                            <div
                                key={i}
                                className={`flex ${
                                    m.role === "user"
                                        ? "justify-end"
                                        : "justify-start"
                                }`}
                            >
                                <div
                                    className={`flex flex-col w-full ${
                                        m.role === "user"
                                            ? "items-end"
                                            : "items-start"
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
                                        {m.text}
                                        {m.attachments &&
                                            m.attachments.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-3">
                                                    {m.attachments.map(
                                                        (att, j) => {
                                                            const a =
                                                                normalizeAttachment(
                                                                    att
                                                                );

                                                            const sizeMB =
                                                                typeof a.size ===
                                                                "number"
                                                                    ? Number(
                                                                          (
                                                                              a.size /
                                                                              (1024 *
                                                                                  1024)
                                                                          ).toFixed(
                                                                              1
                                                                          )
                                                                      )
                                                                    : 0;

                                                            const pillType =
                                                                typeof a.type ===
                                                                    "string" &&
                                                                a.type
                                                                    .toLowerCase()
                                                                    .startsWith(
                                                                        "audio"
                                                                    )
                                                                    ? "audio"
                                                                    : "file";

                                                            const stableId =
                                                                a.objectKey ??
                                                                a.publicUrl ??
                                                                `${a.name}:${a.size}`;

                                                            const ok =
                                                                a.objectKey;

                                                            return (
                                                                <FilePill
                                                                    key={`${
                                                                        m.id ??
                                                                        i
                                                                    }-${j}-${stableId}`}
                                                                    id={
                                                                        stableId
                                                                    }
                                                                    name={
                                                                        a.name
                                                                    }
                                                                    sizeMB={
                                                                        sizeMB
                                                                    }
                                                                    type={
                                                                        pillType as any
                                                                    }
                                                                    publicUrl={
                                                                        a.publicUrl
                                                                    }
                                                                    objectKey={
                                                                        a.objectKey
                                                                    }
                                                                    onDelete={
                                                                        ok
                                                                            ? () =>
                                                                                  deleteAssetEverywhere(
                                                                                      ok
                                                                                  )
                                                                            : undefined
                                                                    }
                                                                />
                                                            );
                                                        }
                                                    )}
                                                </div>
                                            )}
                                    </div>

                                    {showTimestamps && m.ts != null && (
                                        <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                                            <time
                                                dateTime={new Date(
                                                    m.ts
                                                ).toISOString()}
                                                title={new Date(
                                                    m.ts
                                                ).toLocaleString()}
                                            >
                                                {formatTime(m.ts)}
                                            </time>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

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
                                                {Array.from({ length: 12 }).map(
                                                    (_, barIdx) => (
                                                        <span
                                                            key={barIdx}
                                                            className="flex-1 rounded-full bg-neutral-400/80 dark:bg-neutral-500/80"
                                                            style={{
                                                                height: `${
                                                                    4 +
                                                                    ((barIdx *
                                                                        7) %
                                                                        10)
                                                                }px`,
                                                            }}
                                                        />
                                                    )
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="min-w-0 flex flex-col flex-1">
                                        <span className="truncate max-w-[10rem] font-medium">
                                            {f.name}
                                        </span>

                                        {isUploading ? (
                                            <>
                                                {/* shorter line so it won’t wrap */}
                                                <span className="mt-0.5 text-[9px] leading-none tracking-tight opacity-70 whitespace-nowrap">
                                                    {loadedMB.toFixed(1)}/
                                                    {totalMB.toFixed(1)} MB ·{" "}
                                                    {pct}%
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
                                                {isAudio
                                                    ? "Audio file"
                                                    : "Attachment"}{" "}
                                                · {fmtMB(f.size)}
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
                        <label
                            htmlFor={`filePicker-${chatId}`}
                            className="sr-only"
                        >
                            Add files
                        </label>

                        <div className="flex w-full items-center gap-1 rounded-2xl border border-neutral-300 bg-neutral-50/80 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900/60">
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
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        send();
                                    }
                                }}
                                placeholder={`Message ${
                                    import.meta.env.VITE_APP_NAME
                                }…`}
                                className="flex-1 bg-transparent border-0 px-2 py-1 text-sm sm:text-base
                  leading-relaxed resize-none overflow-y-auto max-h-40
                  focus:outline-none focus:ring-0"
                            />

                            <YSButton
                                type="button"
                                onClick={send}
                                disabled={
                                    isUploading ||
                                    (!input.trim() && pendingFiles.length === 0)
                                }
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
