import { useEffect, useRef, useState } from "react";
import type { TabRecord } from "./core";
import type { Chat } from "../components/UISidebar";
import { fetchChatMessages, appendMessage } from "../lib/chatApi";
import { YSONG_SYSTEM_PROMPT } from "../lib/ysongPersona";
import { YSButton } from "../components/YSButton";
import { FilePill } from "../components/FilePill";

const env = (import.meta as any).env || {};
const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = (API_BASE || "").replace(/\/+$/, "");

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

    const [autoTitleRequested, setAutoTitleRequested] = useState(false);

    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);

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

        const typingToken = hasText
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
                              ...(hasText
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

        try {
            const baseMsgs = (current.messages ?? []).map((m: any) => ({
                role: m.role,
                content:
                    typeof m.text === "string" && m.text.trim().length
                        ? m.text
                        : ZWSP,
            }));

            const res = await fetch("https://api.ysong.ai/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [
                        { role: "system", content: YSONG_SYSTEM_PROMPT },
                        ...baseMsgs,
                        { role: "user", content: text },
                    ],
                }),
            });

            if (!res.ok) throw new Error(`ai_failed_${res.status}`);
            const data = await res.json();

            const rawReply = data?.reply ?? "…";
            const reply = sanitizeEmDashesToSentences(rawReply);

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
