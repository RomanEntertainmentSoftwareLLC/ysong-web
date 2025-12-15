import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
    type Dispatch,
    type SetStateAction,
} from "react";
import "../styles/asset-drawer.css";
import type { Chat } from "./UISidebar";
import { YSButton } from "./YSButton";
import { FilePill, type FileKind } from "./FilePill";

const env = (import.meta as any).env || {};
const API_BASE = env.VITE_AUTH_API_URL || env.VITE_API_BASE_URL || "";
const API = (API_BASE || "").replace(/\/+$/, "");

/**
 * Asset records that can live in the drawer without needing a chat message.
 *
 * NOTE:
 *  - chat uploads still appear in the drawer (derived from chat message attachments)
 *  - drawer uploads do NOT create a chat message (so they do not render in ChatPane)
 */
export type DrawerAsset = {
    id: string;
    name: string;
    sizeMB: number;
    type: FileKind;
    publicUrl?: string;
    objectKey?: string;
    addedAt?: number;
};

type Props = {
    chats: Chat[];
    setChats: Dispatch<SetStateAction<Chat[]>>;
    drawerAssets: DrawerAsset[];
    setDrawerAssets: Dispatch<SetStateAction<DrawerAsset[]>>;
};

type Attachment = {
    name: string;
    size: number;
    type: string;
    publicUrl?: string;
    objectKey?: string;
};

function fileKey(f: File) {
    return `${f.name}:${f.size}:${f.lastModified}`;
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

async function removeAttachmentFromMessage(
    messageId: string,
    objectKey: string
) {
    const token = localStorage.getItem("ys_token");
    if (!token) return;

    const removeUrl = API
        ? `${API}/api/messages/remove-attachment`
        : `/api/messages/remove-attachment`;

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
}

export default function AssetDrawer({
    chats,
    setChats,
    drawerAssets,
    setDrawerAssets,
}: Props) {
    const [open, setOpen] = useState(false);
    const handleRef = useRef<HTMLButtonElement | null>(null);

    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [isUploading, setIsUploading] = useState(false);
    const [progressByKey, setProgressByKey] = useState<Record<string, number>>(
        {}
    );

    // drag overlay (avoid flicker with counter)
    const [dragActive, setDragActive] = useState(false);
    const dragCounter = useRef(0);

    // NOTE: this drawer is global (not tied to any one chat).
    // Uploads here should NOT create chat timeline messages.

    // Keep aria-expanded in sync with state
    useEffect(() => {
        if (handleRef.current) {
            handleRef.current.setAttribute(
                "aria-expanded",
                open ? "true" : "false"
            );
        }
    }, [open]);

    const overallPct = useMemo(() => {
        const vals = Object.values(progressByKey);
        if (!vals.length) return 0;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }, [progressByKey]);

    const assets = useMemo(() => {
        // Merge:
        //  1) drawerAssets (uploaded directly into the drawer)
        //  2) chat-derived assets (attachments on any chat message)
        //
        // Keyed by stable id so both surfaces share the same ids.
        const byId = new Map<string, DrawerAsset>();

        // 1) drawer-owned assets first
        for (const a of drawerAssets ?? []) {
            if (!a?.id) continue;
            byId.set(a.id, a);
        }

        // 2) chat-derived assets
        for (const c of chats) {
            for (const msg of c.messages ?? []) {
                const ts = Number((msg as any)?.ts ?? 0) || 0;
                const atts = (msg as any).attachments ?? [];
                if (!Array.isArray(atts) || atts.length === 0) continue;

                for (const raw of atts) {
                    const a = normalizeAttachment(raw);
                    const stableId =
                        a.objectKey ?? a.publicUrl ?? `${a.name}:${a.size}`;

                    const sizeMB = a.size
                        ? Number((a.size / (1024 * 1024)).toFixed(1))
                        : 0;

                    const kind: FileKind = a.type
                        ?.toLowerCase()
                        .startsWith("audio")
                        ? "audio"
                        : "file";

                    const existing = byId.get(stableId);
                    if (!existing) {
                        byId.set(stableId, {
                            id: stableId,
                            name: a.name,
                            sizeMB,
                            type: kind,
                            publicUrl: a.publicUrl,
                            objectKey: a.objectKey,
                            addedAt: ts,
                        });
                    } else {
                        // keep whichever has the newest timestamp
                        const nextAdded = Math.max(existing.addedAt ?? 0, ts);
                        if (nextAdded !== (existing.addedAt ?? 0)) {
                            byId.set(stableId, {
                                ...existing,
                                addedAt: nextAdded,
                            });
                        }
                    }
                }
            }
        }

        // Sort newest first
        return Array.from(byId.values()).sort(
            (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)
        );
    }, [chats, drawerAssets]);

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
                if (xhr.status >= 200 && xhr.status < 300)
                    resolve(xhr.response);
                else reject(new Error(`upload_failed_${xhr.status}`));
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

    async function addAssetsToDrawer(files: File[]) {
        if (!files.length) return;

        // filter (same limit as ChatPane)
        const filtered = files.filter((f) => f.size <= 50 * 1024 * 1024);
        if (!filtered.length) return;

        // show drawer while we work
        setOpen(true);

        // init progress map
        setProgressByKey((prev) => {
            const next = { ...prev };
            for (const f of filtered) next[fileKey(f)] = 0;
            return next;
        });

        setIsUploading(true);

        let uploaded: Attachment[] = [];
        try {
            uploaded = await uploadFiles(filtered);
        } catch (e) {
            console.error("AssetDrawer upload failed:", e);
            return;
        } finally {
            setIsUploading(false);
            setProgressByKey({});
            dragCounter.current = 0;
            setDragActive(false);
        }

        if (!uploaded.length) return;

        // Add to drawer-only state (so these do NOT render in the chat timeline)
        const now = Date.now();
        const next: DrawerAsset[] = uploaded.map((u) => {
            const id = u.objectKey ?? u.publicUrl ?? `${u.name}:${u.size}`;
            const kind: FileKind = u.type?.toLowerCase().startsWith("audio")
                ? "audio"
                : "file";
            const sizeMB = u.size
                ? Number((u.size / (1024 * 1024)).toFixed(1))
                : 0;
            return {
                id,
                name: u.name,
                sizeMB,
                type: kind,
                publicUrl: u.publicUrl,
                objectKey: u.objectKey,
                addedAt: now,
            };
        });

        setDrawerAssets((prev) => {
            const byId = new Map<string, DrawerAsset>();
            for (const a of prev ?? []) byId.set(a.id, a);
            for (const a of next) byId.set(a.id, a);
            return Array.from(byId.values()).sort(
                (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)
            );
        });
    }

    async function deleteAssetEverywhere(objectKey: string) {
        if (!objectKey) return;

        // Snapshot which messages reference this objectKey (for server cleanup)
        const messageIds: string[] = [];
        for (const c of chats) {
            for (const msg of c.messages ?? []) {
                const mid = (msg as any).id as string | undefined;
                const atts = (msg as any).attachments ?? [];
                if (!mid || !Array.isArray(atts)) continue;

                if (
                    atts.some(
                        (raw: any) =>
                            normalizeAttachment(raw).objectKey === objectKey
                    )
                ) {
                    messageIds.push(mid);
                }
            }
        }

        try {
            await deleteUploadFromCloud(objectKey);
        } catch (e) {
            console.error("Delete from cloud failed", e);
        }

        // Best-effort: detach from Neon messages that referenced it
        await Promise.all(
            messageIds.map((mid) => removeAttachmentFromMessage(mid, objectKey))
        );

        // Update UI across all chats/messages
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

        // Also remove from drawer-owned assets
        setDrawerAssets((prev) =>
            (prev ?? []).filter((a) => a.objectKey !== objectKey)
        );
    }

    function triggerPicker() {
        setOpen(true);
        fileInputRef.current?.click();
    }

    function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.currentTarget.value = "";
        if (!files.length) return;
        void addAssetsToDrawer(files);
    }

    function onDragEnter(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current += 1;
        setDragActive(true);
    }

    function onDragLeave(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setDragActive(false);
        }
    }

    function onDragOver(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();
    }

    function onDrop(e: DragEvent) {
        e.preventDefault();
        e.stopPropagation();

        dragCounter.current = 0;
        setDragActive(false);

        const files = Array.from(e.dataTransfer?.files ?? []);
        if (!files.length) return;

        void addAssetsToDrawer(files);
    }

    return (
        <div className="asset-drawer-shell">
            <div className="asset-drawer-container">
                {/* handle */}
                <YSButton
                    ref={handleRef}
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="asset-drawer-handle"
                    aria-expanded="false"
                    aria-controls="asset-drawer-panel"
                >
                    /=====\
                </YSButton>

                {/* panel */}
                <div
                    id="asset-drawer-panel"
                    className={`asset-drawer-panel ${
                        open
                            ? "asset-drawer-panel-open"
                            : "asset-drawer-panel-closed"
                    }`}
                >
                    {/* header */}
                    <div className="asset-drawer-header">
                        <div className="asset-drawer-title">
                            {isUploading
                                ? `UPLOADING… ${overallPct}%`
                                : `ASSETS (${assets.length})`}
                            <span className="asset-drawer-hint">
                                Drop files here or click +
                            </span>
                        </div>

                        <div className="asset-drawer-actions">
                            <YSButton
                                type="button"
                                className="asset-drawer-add-btn"
                                onClick={triggerPicker}
                                disabled={isUploading}
                                title="Add files"
                            >
                                +
                            </YSButton>

                            <YSButton
                                type="button"
                                onClick={() => setOpen(false)}
                                className="asset-drawer-close-btn"
                                disabled={isUploading}
                            >
                                Close
                            </YSButton>
                        </div>

                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={onPickFiles}
                        />
                    </div>

                    {/* scrollable content + dropzone */}
                    <div
                        className="asset-drawer-scroll asset-drawer-dropzone"
                        onDragEnter={onDragEnter}
                        onDragLeave={onDragLeave}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                    >
                        {(dragActive || isUploading) && (
                            <div className="asset-drawer-dropoverlay">
                                <div className="asset-drawer-dropcard">
                                    <div className="asset-drawer-dropcard-title">
                                        Drop to upload
                                    </div>
                                    <div className="asset-drawer-dropcard-sub">
                                        Files will be added to your current chat
                                        and appear here instantly.
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="asset-drawer-inner">
                            <div className="asset-pill-grid">
                                {assets.map((asset) => (
                                    <FilePill
                                        key={asset.id}
                                        id={asset.id}
                                        name={asset.name}
                                        sizeMB={asset.sizeMB}
                                        type={asset.type as any}
                                        publicUrl={asset.publicUrl}
                                        objectKey={asset.objectKey}
                                        onDelete={
                                            asset.objectKey
                                                ? () =>
                                                      deleteAssetEverywhere(
                                                          asset.objectKey!
                                                      )
                                                : undefined
                                        }
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
