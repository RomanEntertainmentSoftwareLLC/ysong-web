import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TabRendererProps } from "./core";
import { getActiveBandProfile, getBandProfile, setActiveBandId } from "../lib/bandLibrary";
import { localAiChat } from "../lib/localAiApi";
import { generateArtworkImage } from "../lib/artworkAiApi";

type ArtFormat = "square" | "landscape" | "portrait" | "custom";
type Tool = "select" | "brush" | "pencil" | "eraser" | "text" | "rect" | "ellipse" | "line" | "crop" | "eyedropper";
type BlendMode = "source-over" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
type ResampleMode = "automatic" | "bicubic-smoother" | "preserve-details" | "bicubic-sharper" | "bicubic" | "bilinear" | "nearest";

type LayerBase = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

type ImageLayer = LayerBase & {
  kind: "image";
  blob: Blob;
  sourceName: string;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
};

type TextLayer = LayerBase & {
  kind: "text";
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: "400" | "600" | "700" | "900";
  align: "left" | "center" | "right";
};

type ShapeLayer = LayerBase & {
  kind: "shape";
  shape: "rect" | "ellipse" | "line";
  fill: string;
  stroke: string;
  strokeWidth: number;
};

type PaintPoint = { x: number; y: number };
type PaintStroke = { points: PaintPoint[]; color: string; size: number; opacity: number; mode: "paint" | "erase" };
type PaintLayer = LayerBase & { kind: "paint"; strokes: PaintStroke[] };
type ArtLayer = ImageLayer | TextLayer | ShapeLayer | PaintLayer;

type ArtworkProject = {
  projectId: string;
  version: 2;
  title: string;
  artist: string;
  direction: string;
  prompt: string;
  format: ArtFormat;
  width: number;
  height: number;
  background: string;
  resampleMode?: ResampleMode;
  layers: ArtLayer[];
  updatedAt: number;
};

type Gesture =
  | { kind: "move"; layerId: string; startX: number; startY: number; layerX: number; layerY: number }
  | { kind: "shape"; shape: "rect" | "ellipse" | "line"; startX: number; startY: number; x: number; y: number }
  | { kind: "crop"; startX: number; startY: number; x: number; y: number }
  | { kind: "paint"; layerId: string; strokeIndex: number };

const DB = "ysong-artwork-studio";
const PROJECT_STORE = "projects";
const LEGACY_STORE = "files";
const PROJECT_KEY = "active-project-v2";
const PROJECT_PREFIX = "project-v2:";
const ACTIVE_PROJECT_ID_KEY = "ysong.artwork.activeProjectId.v1";
const LEGACY_REF_KEY = "reference-image";
const DEFAULT_PROJECT: ArtworkProject = {
  projectId: "",
  version: 2,
  title: "",
  artist: "",
  direction: "",
  prompt: "",
  format: "square",
  width: 1000,
  height: 1000,
  background: "#111111",
  resampleMode: "automatic",
  layers: [],
  updatedAt: Date.now(),
};

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
function cloneProject<T>(value: T): T { return typeof structuredClone === "function" ? structuredClone(value) : value; }
function sanitizeName(value: string) { return (value || "ysong-artwork").replace(/[<>:"/\\|?*]+/g, "-").trim() || "ysong-artwork"; }

function openArtworkDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE);
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function ensureProjectId(project: ArtworkProject): ArtworkProject { return project.projectId ? project : { ...project, projectId: crypto.randomUUID() }; }
function projectStorageKey(id: string) { return `${PROJECT_PREFIX}${id}`; }

async function loadArtworkProjectById(projectId: string): Promise<ArtworkProject | null> {
  if (!("indexedDB" in window) || !projectId) return null;
  const db = await openArtworkDb();
  try { return await new Promise<ArtworkProject | null>((resolve, reject) => { const tx=db.transaction(PROJECT_STORE,"readonly"); const req=tx.objectStore(PROJECT_STORE).get(projectStorageKey(projectId)); req.onsuccess=()=>resolve(req.result?.version===2?ensureProjectId(req.result as ArtworkProject):null); req.onerror=()=>reject(req.error); }); }
  finally { db.close(); }
}

async function loadArtworkProject(): Promise<ArtworkProject | null> {
  if (!("indexedDB" in window)) return null;
  const activeId=window.localStorage.getItem(ACTIVE_PROJECT_ID_KEY)||"";
  if(activeId){const active=await loadArtworkProjectById(activeId);if(active)return active;}
  const db = await openArtworkDb();
  try {
    return await new Promise<ArtworkProject | null>((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE, "readonly");
      const req = tx.objectStore(PROJECT_STORE).get(PROJECT_KEY);
      req.onsuccess = () => resolve(req.result && req.result.version === 2 ? ensureProjectId(req.result as ArtworkProject) : null);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

async function saveArtworkProject(input: ArtworkProject) {
  if (!("indexedDB" in window)) return;
  const project=ensureProjectId(input); window.localStorage.setItem(ACTIVE_PROJECT_ID_KEY,project.projectId);
  const db = await openArtworkDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE, "readwrite");
      const store=tx.objectStore(PROJECT_STORE); store.put(project, projectStorageKey(project.projectId)); store.put(project, PROJECT_KEY);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

type ArtworkProjectMeta={projectId:string;title:string;artist:string;width:number;height:number;updatedAt:number};
async function listArtworkProjects():Promise<ArtworkProjectMeta[]>{
  if (!("indexedDB" in window)) return [];
  const db=await openArtworkDb();
  try{return await new Promise<ArtworkProjectMeta[]>((resolve,reject)=>{const tx=db.transaction(PROJECT_STORE,"readonly");const store=tx.objectStore(PROJECT_STORE);const keysReq=store.getAllKeys();const valuesReq=store.getAll();tx.oncomplete=()=>{const keys=keysReq.result;const values=valuesReq.result as ArtworkProject[];const rows:ArtworkProjectMeta[]=[];for(let i=0;i<keys.length;i++){const key=String(keys[i]);const project=values[i];if(!key.startsWith(PROJECT_PREFIX)||!project||project.version!==2)continue;const normalized=ensureProjectId(project);rows.push({projectId:normalized.projectId,title:normalized.title||"Untitled Artwork",artist:normalized.artist||"",width:normalized.width,height:normalized.height,updatedAt:normalized.updatedAt||0});}resolve(rows.sort((a,b)=>b.updatedAt-a.updatedAt));};tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}

async function loadLegacyReference(): Promise<Blob | null> {
  if (!("indexedDB" in window)) return null;
  const db = await openArtworkDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(LEGACY_STORE, "readonly");
      const req = tx.objectStore(LEGACY_STORE).get(LEGACY_REF_KEY);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

function newBase(name: string, x: number, y: number, width: number, height: number): LayerBase {
  return { id: crypto.randomUUID(), name, visible: true, locked: false, opacity: 1, blendMode: "source-over", x, y, width, height, rotation: 0, flipX: false, flipY: false };
}

async function imageSize(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  try { return { width: bmp.width, height: bmp.height }; }
  finally { bmp.close(); }
}

function fitImageLayer(project: ArtworkProject, blob: Blob, sourceName: string, natural: { width: number; height: number }): ImageLayer {
  const maxW = project.width * 0.82;
  const maxH = project.height * 0.82;
  const scale = Math.min(maxW / Math.max(1, natural.width), maxH / Math.max(1, natural.height), 1);
  const width = Math.max(1, natural.width * scale);
  const height = Math.max(1, natural.height * scale);
  return {
    ...newBase(sourceName || "Image", (project.width - width) / 2, (project.height - height) / 2, width, height),
    kind: "image", blob, sourceName,
    brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0,
  };
}

function mapBlend(mode: BlendMode): GlobalCompositeOperation { return mode as GlobalCompositeOperation; }

type ImageCache = Map<string, { blob: Blob; bitmap: ImageBitmap }>;
async function bitmapFor(layer: ImageLayer, cache: ImageCache) {
  const current = cache.get(layer.id);
  if (current?.blob === layer.blob) return current.bitmap;
  if (current) { try { current.bitmap.close(); } catch { /* already released */ } }
  const bitmap = await createImageBitmap(layer.blob);
  cache.set(layer.id, { blob: layer.blob, bitmap });
  return bitmap;
}

async function renderArtwork(canvas: HTMLCanvasElement, project: ArtworkProject, cache: ImageCache, transparent = false) {
  canvas.width = Math.max(1, Math.round(project.width));
  canvas.height = Math.max(1, Math.round(project.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!transparent) {
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (const layer of project.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity, 0, 1);
    ctx.globalCompositeOperation = mapBlend(layer.blendMode);
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.translate(-layer.width / 2, -layer.height / 2);

    if (layer.kind === "image") {
      try {
        const bmp = await bitmapFor(layer, cache);
        const resample = project.resampleMode || "automatic";
        ctx.imageSmoothingEnabled = resample !== "nearest";
        ctx.imageSmoothingQuality = resample === "bilinear" ? "medium" : resample === "nearest" ? "low" : "high";
        ctx.filter = `brightness(${layer.brightness}%) contrast(${layer.contrast}%) saturate(${layer.saturation}%) hue-rotate(${layer.hue}deg) blur(${layer.blur}px)`;
        ctx.drawImage(bmp, 0, 0, layer.width, layer.height);
        ctx.filter = "none";
      } catch { /* skip an unreadable raster layer without taking down the canvas */ }
    } else if (layer.kind === "text") {
      ctx.fillStyle = layer.color;
      ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
      ctx.textAlign = layer.align;
      ctx.textBaseline = "top";
      const anchorX = layer.align === "center" ? layer.width / 2 : layer.align === "right" ? layer.width : 0;
      const lines = layer.text.split("\n");
      lines.forEach((line, index) => ctx.fillText(line || " ", anchorX, index * layer.fontSize * 1.2, layer.width));
    } else if (layer.kind === "shape") {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.fillStyle = layer.fill;
      if (layer.shape === "rect") {
        if (layer.fill !== "transparent") ctx.fillRect(0, 0, layer.width, layer.height);
        if (layer.strokeWidth > 0) ctx.strokeRect(layer.strokeWidth / 2, layer.strokeWidth / 2, Math.max(0, layer.width - layer.strokeWidth), Math.max(0, layer.height - layer.strokeWidth));
      } else if (layer.shape === "ellipse") {
        ctx.beginPath(); ctx.ellipse(layer.width / 2, layer.height / 2, Math.abs(layer.width / 2), Math.abs(layer.height / 2), 0, 0, Math.PI * 2);
        if (layer.fill !== "transparent") ctx.fill();
        if (layer.strokeWidth > 0) ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(layer.width, layer.height); ctx.stroke();
      }
    } else if (layer.kind === "paint") {
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(layer.width));
      off.height = Math.max(1, Math.round(layer.height));
      const pctx = off.getContext("2d");
      if (pctx) {
        pctx.lineCap = "round"; pctx.lineJoin = "round";
        for (const stroke of layer.strokes) {
          if (!stroke.points.length) continue;
          pctx.save();
          pctx.globalAlpha = stroke.opacity;
          pctx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
          pctx.strokeStyle = stroke.color;
          pctx.lineWidth = stroke.size;
          pctx.beginPath();
          pctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) pctx.lineTo(stroke.points[i].x, stroke.points[i].y);
          if (stroke.points.length === 1) pctx.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01);
          pctx.stroke(); pctx.restore();
        }
        ctx.drawImage(off, 0, 0, layer.width, layer.height);
      }
    }
    ctx.restore();
  }
}

export default function ArtworkStudioPane(_props: TabRendererProps) {
  void _props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const cacheRef = useRef<ImageCache>(new Map());
  const renderVersionRef = useRef(0);
  const [project, setProject] = useState<ArtworkProject>(DEFAULT_PROJECT);
  const [loaded, setLoaded] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#ffffff");
  const [secondaryColor, setSecondaryColor] = useState("#111111");
  const [brushSize, setBrushSize] = useState(18);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [zoom, setZoom] = useState(70);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [aiBusy, setAiBusy] = useState<"refine" | "generate" | null>(null);
  const [status, setStatus] = useState("");
  const [rightTab, setRightTab] = useState<"layers" | "properties" | "ai">("layers");
  const [canvasDragActive, setCanvasDragActive] = useState(false);
  const [exportType, setExportType] = useState<"png" | "jpeg" | "webp">("png");
  const [canvasSizeDraft, setCanvasSizeDraft] = useState({ width: 1000, height: 1000 });
  const [imageSizeOpen, setImageSizeOpen] = useState(false);
  const [imageSizeDraft, setImageSizeDraft] = useState({ width: 1000, height: 1000, linked: true, resampleMode: "automatic" as ResampleMode });
  const [menuOpen,setMenuOpen]=useState<"file"|"edit"|"image"|"layer"|"project"|"view"|null>(null);
  const [newProjectOpen,setNewProjectOpen]=useState(false);
  const [newProjectDraft,setNewProjectDraft]=useState({title:"Untitled Artwork",artist:"",width:3000,height:3000,background:"#111111",format:"square" as ArtFormat});
  const [recentProjects,setRecentProjects]=useState<ArtworkProjectMeta[]>([]);
  const historyRef = useRef<ArtworkProject[]>([]);
  const historyIndexRef = useRef(-1);
  const [, setHistoryTick] = useState(0);
  const beforeGestureRef = useRef<ArtworkProject | null>(null);
  const internalClipboardRef = useRef<ArtLayer | null>(null);
  const projectRef = useRef<ArtworkProject>(DEFAULT_PROJECT);
  const generationInFlightRef = useRef(false);

  useEffect(() => { projectRef.current = project; }, [project]);

  const selected = useMemo(() => project.layers.find((l) => l.id === selectedLayerId) ?? null, [project.layers, selectedLayerId]);
  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1;

  const resetHistory = useCallback((next: ArtworkProject) => {
    historyRef.current = [cloneProject(next)]; historyIndexRef.current = 0; setHistoryTick((v) => v + 1);
  }, []);

  const commit = useCallback((next: ArtworkProject, history = true) => {
    const stamped = { ...next, updatedAt: Date.now() };
    setProject(stamped);
    if (history) {
      const list = historyRef.current.slice(0, historyIndexRef.current + 1);
      list.push(cloneProject(stamped));
      if (list.length > 80) list.shift();
      historyRef.current = list;
      historyIndexRef.current = list.length - 1;
      setHistoryTick((v) => v + 1);
    }
  }, []);

  const patchProject = (patch: Partial<ArtworkProject>) => commit({ ...project, ...patch });
  const patchLayer = (id: string, patch: Partial<ArtLayer>, history = true) => {
    const layers = project.layers.map((layer) => layer.id === id ? ({ ...layer, ...patch } as ArtLayer) : layer);
    commit({ ...project, layers }, history);
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = await loadArtworkProject().catch(() => null);
      if (!alive) return;
      if (stored) {
        setProject(stored); setCanvasSizeDraft({ width: stored.width, height: stored.height }); resetHistory(stored); setLoaded(true); void listArtworkProjects().then(setRecentProjects).catch(()=>{}); return;
      }
      let next = { ...DEFAULT_PROJECT, projectId:crypto.randomUUID(), updatedAt: Date.now() };
      const legacy = await loadLegacyReference().catch(() => null);
      if (legacy) {
        const size = await imageSize(legacy).catch(() => ({ width: 1000, height: 1000 }));
        const layer = fitImageLayer(next, legacy, "Reference image", size);
        next = { ...next, layers: [layer] };
        setSelectedLayerId(layer.id);
      }
      setProject(next); setCanvasSizeDraft({ width: next.width, height: next.height }); resetHistory(next); setLoaded(true); void listArtworkProjects().then(setRecentProjects).catch(()=>{});
    })();
    return () => { alive = false; };
  }, [resetHistory]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => void saveArtworkProject(project).then(()=>listArtworkProjects()).then(setRecentProjects).catch(() => {}), 700);
    return () => window.clearTimeout(timer);
  }, [project, loaded]);

  useEffect(() => {
    if (!loaded || !canvasRef.current) return;
    const version = ++renderVersionRef.current;
    void renderArtwork(canvasRef.current, project, cacheRef.current).then(() => { if (version !== renderVersionRef.current) return; });
  }, [project, loaded]);

  useEffect(() => () => { for (const entry of cacheRef.current.values()) { try { entry.bitmap.close(); } catch { /* already released */ } } cacheRef.current.clear(); }, []);

  const addImage = async (file: File | Blob, sourceName = "Image") => {
    if (!file.type.startsWith("image/")) { setStatus("That file is not an image."); return; }
    const size = await imageSize(file).catch(() => ({ width: project.width, height: project.height }));
    const layer = fitImageLayer(project, file, sourceName, size);
    commit({ ...project, layers: [...project.layers, layer] });
    setSelectedLayerId(layer.id); setTool("select"); setRightTab("layers"); setStatus(`Added ${sourceName} as a new layer.`);
  };

  const addText = (value = "Text", size = 80) => {
    const width = Math.max(240, project.width * 0.7), height = size * 1.5;
    const layer: TextLayer = { ...newBase(value === project.title ? "Title" : "Text", (project.width - width) / 2, (project.height - height) / 2, width, height), kind: "text", text: value, color, fontSize: size, fontFamily: "Arial", fontWeight: "700", align: "center" };
    commit({ ...project, layers: [...project.layers, layer] }); setSelectedLayerId(layer.id); setRightTab("properties"); setTool("select");
  };

  const ensurePaintLayer = () => {
    const current = project.layers.find((l) => l.id === selectedLayerId && l.kind === "paint") as PaintLayer | undefined;
    if (current && !current.locked) return current;
    const layer: PaintLayer = { ...newBase("Paint Layer", 0, 0, project.width, project.height), kind: "paint", strokes: [] };
    const next = { ...project, layers: [...project.layers, layer] };
    setProject(next); setSelectedLayerId(layer.id);
    return layer;
  };

  const pointerToProject = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / Math.max(1, rect.width) * project.width, 0, project.width), y: clamp((e.clientY - rect.top) / Math.max(1, rect.height) * project.height, 0, project.height) };
  };

  const hitLayer = (x: number, y: number) => {
    for (let i = project.layers.length - 1; i >= 0; i--) {
      const layer = project.layers[i];
      if (!layer.visible || layer.locked || layer.kind === "paint") continue;
      if (x >= layer.x && x <= layer.x + layer.width && y >= layer.y && y <= layer.y + layer.height) return layer;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointerToProject(e);
    beforeGestureRef.current = cloneProject(project);

    if (tool === "eyedropper") {
      const ctx = canvasRef.current?.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        const px = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
        const hex = `#${[px[0], px[1], px[2]].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        setColor(hex); setStatus(`Picked ${hex}`);
      }
      setTool("select"); return;
    }
    if (tool === "text") { addText("Text", Math.max(36, Math.round(project.width * 0.06))); return; }
    if (tool === "rect" || tool === "ellipse" || tool === "line") { setGesture({ kind: "shape", shape: tool, startX: p.x, startY: p.y, x: p.x, y: p.y }); return; }
    if (tool === "crop") { setCropRect(null); setGesture({ kind: "crop", startX: p.x, startY: p.y, x: p.x, y: p.y }); return; }
    if (tool === "brush" || tool === "pencil" || tool === "eraser") {
      const layer = ensurePaintLayer();
      const stroke: PaintStroke = { points: [{ x: p.x - layer.x, y: p.y - layer.y }], color, size: tool === "pencil" ? 2 : brushSize, opacity: brushOpacity, mode: tool === "eraser" ? "erase" : "paint" };
      const layers = project.layers.some((l) => l.id === layer.id) ? project.layers : [...project.layers, layer];
      const updated = layers.map((l) => l.id === layer.id ? ({ ...layer, strokes: [...layer.strokes, stroke] } as PaintLayer) : l);
      setProject({ ...project, layers: updated }); setSelectedLayerId(layer.id); setGesture({ kind: "paint", layerId: layer.id, strokeIndex: layer.strokes.length }); return;
    }
    const layer = hitLayer(p.x, p.y);
    setSelectedLayerId(layer?.id ?? null);
    if (layer) setGesture({ kind: "move", layerId: layer.id, startX: p.x, startY: p.y, layerX: layer.x, layerY: layer.y });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!gesture) return;
    const p = pointerToProject(e);
    if (gesture.kind === "move") {
      const layers = project.layers.map((l) => l.id === gesture.layerId ? ({ ...l, x: gesture.layerX + (p.x - gesture.startX), y: gesture.layerY + (p.y - gesture.startY) } as ArtLayer) : l);
      setProject({ ...project, layers });
    } else if (gesture.kind === "paint") {
      const layers = project.layers.map((l) => {
        if (l.id !== gesture.layerId || l.kind !== "paint") return l;
        const strokes = l.strokes.map((s, i) => i === gesture.strokeIndex ? { ...s, points: [...s.points, { x: p.x - l.x, y: p.y - l.y }] } : s);
        return { ...l, strokes };
      });
      setProject({ ...project, layers });
    } else if (gesture.kind === "shape" || gesture.kind === "crop") setGesture({ ...gesture, x: p.x, y: p.y } as Gesture);
  };

  const finishGesture = () => {
    if (!gesture) return;
    if (gesture.kind === "shape") {
      const x = Math.min(gesture.startX, gesture.x), y = Math.min(gesture.startY, gesture.y);
      const width = Math.max(2, Math.abs(gesture.x - gesture.startX)), height = Math.max(2, Math.abs(gesture.y - gesture.startY));
      const layer: ShapeLayer = { ...newBase(gesture.shape === "line" ? "Line" : gesture.shape === "ellipse" ? "Ellipse" : "Rectangle", x, y, width, height), kind: "shape", shape: gesture.shape, fill: gesture.shape === "line" ? "transparent" : secondaryColor, stroke: color, strokeWidth: Math.max(1, brushSize / 4) };
      commit({ ...project, layers: [...project.layers, layer] }); setSelectedLayerId(layer.id); setTool("select");
    } else if (gesture.kind === "crop") {
      setCropRect({ x: Math.min(gesture.startX, gesture.x), y: Math.min(gesture.startY, gesture.y), width: Math.abs(gesture.x - gesture.startX), height: Math.abs(gesture.y - gesture.startY) });
    } else {
      const before = beforeGestureRef.current;
      if (before) {
        const list = historyRef.current.slice(0, historyIndexRef.current + 1);
        list.push(cloneProject({ ...project, updatedAt: Date.now() }));
        if (list.length > 80) list.shift();
        historyRef.current = list; historyIndexRef.current = list.length - 1; setHistoryTick((v) => v + 1);
      }
    }
    setGesture(null); beforeGestureRef.current = null;
  };

  const applyCrop = () => {
    if (!cropRect || cropRect.width < 4 || cropRect.height < 4) return;
    const x = Math.round(cropRect.x), y = Math.round(cropRect.y), width = Math.max(1, Math.round(cropRect.width)), height = Math.max(1, Math.round(cropRect.height));
    const layers = project.layers.map((l) => ({ ...l, x: l.x - x, y: l.y - y } as ArtLayer));
    commit({ ...project, format: "custom", width, height, layers }); setCanvasSizeDraft({ width, height }); setCropRect(null); setTool("select");
  };

  const setFormat = (format: ArtFormat) => {
    const dims = format === "square" ? { width: 1000, height: 1000 } : format === "landscape" ? { width: 1600, height: 900 } : format === "portrait" ? { width: 1000, height: 1250 } : { width: project.width, height: project.height };
    commit({ ...project, format, ...dims }); setCanvasSizeDraft(dims);
  };

  const resizeCanvas = () => {
    const width = Math.round(clamp(canvasSizeDraft.width, 64, 8192)), height = Math.round(clamp(canvasSizeDraft.height, 64, 8192));
    commit({ ...project, format: "custom", width, height }); setCanvasSizeDraft({ width, height });
  };

  const openImageSize = () => {
    setImageSizeDraft({ width: Math.round(project.width), height: Math.round(project.height), linked: true, resampleMode: project.resampleMode || "automatic" });
    setImageSizeOpen(true);
  };
  const applyImageSize = () => {
    const width = Math.round(clamp(imageSizeDraft.width, 64, 8192));
    const height = Math.round(clamp(imageSizeDraft.height, 64, 8192));
    const sx = width / Math.max(1, project.width), sy = height / Math.max(1, project.height), scalar = Math.sqrt(Math.abs(sx * sy));
    const layers = project.layers.map((layer) => {
      const next: ArtLayer = { ...layer, x: layer.x * sx, y: layer.y * sy, width: Math.max(1, layer.width * sx), height: Math.max(1, layer.height * sy) } as ArtLayer;
      if (next.kind === "text") next.fontSize = Math.max(1, next.fontSize * scalar);
      else if (next.kind === "shape") next.strokeWidth = Math.max(0, next.strokeWidth * scalar);
      else if (next.kind === "paint") next.strokes = next.strokes.map((stroke) => ({ ...stroke, size: Math.max(.25, stroke.size * scalar), points: stroke.points.map((point) => ({ x: point.x * sx, y: point.y * sy })) }));
      return next;
    });
    commit({ ...project, format: "custom", width, height, resampleMode: imageSizeDraft.resampleMode, layers });
    setCanvasSizeDraft({ width, height }); setImageSizeOpen(false); setStatus(`Image resized to ${width}×${height} using ${imageSizeDraft.resampleMode.replace(/-/g, " ")}.`);
  };

  const placeSelectedImage = (mode: "fit" | "fill" | "stretch") => {
    if (!selected || selected.kind !== "image") return;
    if (mode === "stretch") { patchLayer(selected.id, { x: 0, y: 0, width: project.width, height: project.height } as Partial<ArtLayer>); return; }
    const aspect = Math.max(.0001, selected.width / Math.max(1, selected.height));
    const scale = mode === "fill" ? Math.max(project.width / Math.max(1, selected.width), project.height / Math.max(1, selected.height)) : Math.min(project.width / Math.max(1, selected.width), project.height / Math.max(1, selected.height));
    const width = selected.width * scale, height = width / aspect;
    patchLayer(selected.id, { width, height, x: (project.width - width) / 2, y: (project.height - height) / 2 } as Partial<ArtLayer>);
  };

  const removeSelected = () => {
    if (!selected || selected.locked) return;
    commit({ ...project, layers: project.layers.filter((l) => l.id !== selected.id) }); setSelectedLayerId(null);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const copy = cloneProject(selected) as ArtLayer; copy.id = crypto.randomUUID(); copy.name = `${copy.name} copy`; copy.x += 20; copy.y += 20;
    commit({ ...project, layers: [...project.layers, copy] }); setSelectedLayerId(copy.id);
  };
  const moveLayer = (delta: number) => {
    if (!selected) return;
    const index = project.layers.findIndex((l) => l.id === selected.id); const target = clamp(index + delta, 0, project.layers.length - 1);
    if (target === index) return;
    const layers = [...project.layers]; const [item] = layers.splice(index, 1); layers.splice(target, 0, item); commit({ ...project, layers });
  };
  const reorderLayers = (displayOrderIds: string[]) => {
    if (displayOrderIds.length !== project.layers.length) return;
    const byId = new Map(project.layers.map((layer) => [layer.id, layer] as const));
    const displayLayers = displayOrderIds.map((id) => byId.get(id)).filter((layer): layer is ArtLayer => Boolean(layer));
    if (displayLayers.length !== project.layers.length) return;
    commit({ ...project, layers: [...displayLayers].reverse() });
  };

  const undo = () => {
    if (!canUndo) return;
    historyIndexRef.current -= 1; const next = cloneProject(historyRef.current[historyIndexRef.current]); setProject(next); if (selectedLayerId && !next.layers.some((l) => l.id === selectedLayerId)) setSelectedLayerId(null); setHistoryTick((v) => v + 1);
  };
  const redo = () => {
    if (!canRedo) return;
    historyIndexRef.current += 1; const next = cloneProject(historyRef.current[historyIndexRef.current]); setProject(next); setHistoryTick((v) => v + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selected) { e.preventDefault(); internalClipboardRef.current = cloneProject(selected); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && internalClipboardRef.current) { e.preventDefault(); const copy = cloneProject(internalClipboardRef.current); copy.id = crypto.randomUUID(); copy.x += 24; copy.y += 24; commit({ ...project, layers: [...project.layers, copy] }); setSelectedLayerId(copy.id); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); removeSelected(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, selected, canUndo, canRedo]);

  const applyBandIdentity = async (explicitId?: string) => {
    const band = explicitId ? await getBandProfile(explicitId).catch(() => null) : await getActiveBandProfile().catch(() => null);
    if (!band) { setStatus("No saved band is selected yet. Create one in Band Creation first."); return; }
    setActiveBandId(band.id);
    let next = { ...project, artist: band.name || project.artist, direction: project.direction || band.symbol || band.bio || "" };
    if (band.image) {
      const size = await imageSize(band.image).catch(() => ({ width: 600, height: 600 }));
      const layer = fitImageLayer(next, band.image, `${band.name || "Band"} logo`, size);
      layer.width *= 0.45; layer.height *= 0.45; layer.x = next.width - layer.width - 50; layer.y = next.height - layer.height - 50;
      next = { ...next, layers: [...next.layers, layer] }; setSelectedLayerId(layer.id);
    }
    commit(next); setStatus(`Loaded ${band.name || "band"} identity${band.image ? " and added its image as a layer" : ""}.`);
  };

  useEffect(() => {
    const onUseBand = (event: Event) => void applyBandIdentity(String((event as CustomEvent<{ id?: string }>).detail?.id || "") || undefined);
    window.addEventListener("ysong:artwork-use-band", onUseBand as EventListener);
    return () => window.removeEventListener("ysong:artwork-use-band", onUseBand as EventListener);
    // Project changes intentionally refresh the event closure so imported identity lands in the current document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const refine = async () => {
    if (aiBusy) return;
    const source = projectRef.current;
    setAiBusy("refine"); setStatus("");
    try {
      const reply = await localAiChat([
        { role: "system", content: "You are YSong Artwork Studio. Turn the user's album/single art direction into one concise production-ready image prompt. Preserve requested subjects, composition, mood, palette, typography constraints, and aspect ratio. Do not claim an image was generated." },
        { role: "user", content: `Title: ${source.title}\nArtist: ${source.artist}\nCanvas: ${source.width}x${source.height}\nDirection: ${source.direction}\nCurrent prompt: ${source.prompt}\nExisting editor layers: ${source.layers.map((l) => `${l.name} (${l.kind})`).join(", ") || "none"}. The chat bridge does not visually inspect raster layers, so do not claim that it did.` },
      ]);
      const current = projectRef.current;
      commit({ ...current, prompt: reply }); setRightTab("ai");
    } catch (e) { setStatus(`YSong AI could not refine the concept. ${e instanceof Error ? e.message : ""}`.trim()); }
    finally { setAiBusy(null); }
  };

  const generateArtwork = async () => {
    if (generationInFlightRef.current || aiBusy) { setStatus("Artwork generation is already running. Your current art is safe."); return; }
    const source = projectRef.current;
    const prompt = (source.prompt.trim() || source.direction.trim());
    if (!prompt) { setStatus("Add an art direction or generation prompt first."); return; }
    generationInFlightRef.current = true;
    setAiBusy("generate"); setStatus("Generating artwork… Keep editing if you want; existing layers will not be replaced.");
    try {
      const composed = [
        source.title ? `Release title: ${source.title}.` : "",
        source.artist ? `Artist/band: ${source.artist}.` : "",
        prompt,
        source.direction.trim() && source.prompt.trim() ? `Art direction: ${source.direction.trim()}` : "",
      ].filter(Boolean).join("\n");
      const blob = await generateArtworkImage(composed, source.width, source.height);
      const current = projectRef.current;
      const size = await imageSize(blob).catch(() => ({ width: current.width, height: current.height }));
      const layer = fitImageLayer(current, blob, "AI Generated Artwork", size);
      const next = { ...current, layers: [...current.layers, layer] };
      projectRef.current = next;
      commit(next);
      setSelectedLayerId(layer.id); setRightTab("layers"); setTool("select");
      setStatus("Generated artwork added as a NEW layer. Your previous artwork is still underneath it; Undo removes only this generated layer.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Image generation failed.";
      setStatus(message === "artwork_generation_not_configured" ? "Artwork generation is not configured. YSong can reuse the existing server-side OPENAI_API_KEY; restart the Auth API after configuring it." : `Artwork generation failed. ${message}`);
    } finally {
      generationInFlightRef.current = false;
      setAiBusy(null);
    }
  };

  const createNewProject=()=>{const width=Math.round(clamp(newProjectDraft.width,64,8192)),height=Math.round(clamp(newProjectDraft.height,64,8192));const next:ArtworkProject={...DEFAULT_PROJECT,projectId:crypto.randomUUID(),title:newProjectDraft.title.trim()==="Untitled Artwork"?"":newProjectDraft.title.trim(),artist:newProjectDraft.artist.trim(),format:newProjectDraft.format,width,height,background:newProjectDraft.background,layers:[],updatedAt:Date.now()};setProject(next);projectRef.current=next;setSelectedLayerId(null);setCanvasSizeDraft({width,height});setImageSizeDraft({width,height,linked:true,resampleMode:"automatic"});resetHistory(next);window.localStorage.setItem(ACTIVE_PROJECT_ID_KEY,next.projectId);setNewProjectOpen(false);setMenuOpen(null);setStatus(`Created ${width}×${height} artwork project.`);};
  const openRecentProject=async(projectId:string)=>{if(projectId===project.projectId){setMenuOpen(null);return;}await saveArtworkProject(project).catch(()=>{});const next=await loadArtworkProjectById(projectId).catch(()=>null);if(!next){setStatus("Could not open that local artwork project.");return;}setProject(next);projectRef.current=next;setSelectedLayerId(null);setCanvasSizeDraft({width:next.width,height:next.height});setImageSizeDraft({width:next.width,height:next.height,linked:true,resampleMode:next.resampleMode||"automatic"});resetHistory(next);window.localStorage.setItem(ACTIVE_PROJECT_ID_KEY,next.projectId);setMenuOpen(null);setStatus(`Opened ${next.title||"Untitled Artwork"}.`);};
  const saveAsProject=async()=>{const title=window.prompt("Save artwork project as",project.title||"Untitled Artwork")?.trim();if(!title)return;const next={...cloneProject(project),projectId:crypto.randomUUID(),title,updatedAt:Date.now()};setProject(next);projectRef.current=next;resetHistory(next);await saveArtworkProject(next).catch(()=>{});void listArtworkProjects().then(setRecentProjects).catch(()=>{});setMenuOpen(null);setStatus(`Saved a new local project copy: ${title}.`);};

  const exportArtwork = async () => {
    setStatus("Rendering…");
    const canvas = document.createElement("canvas");
    await renderArtwork(canvas, project, cacheRef.current, exportType === "png");
    const mime = exportType === "jpeg" ? "image/jpeg" : exportType === "webp" ? "image/webp" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, exportType === "jpeg" ? 0.94 : 0.96));
    if (!blob) { setStatus("Could not render the artwork."); return; }
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${sanitizeName(project.title || "ysong-artwork")}.${exportType === "jpeg" ? "jpg" : exportType}`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500); setStatus(`Exported ${project.width}×${project.height} ${exportType.toUpperCase()}.`);
  };

  const overlayRect = gesture && (gesture.kind === "shape" || gesture.kind === "crop") ? { x: Math.min(gesture.startX, gesture.x), y: Math.min(gesture.startY, gesture.y), width: Math.abs(gesture.x - gesture.startX), height: Math.abs(gesture.y - gesture.startY) } : cropRect;
  const selectedStyle = selected ? { left: `${selected.x / project.width * 100}%`, top: `${selected.y / project.height * 100}%`, width: `${selected.width / project.width * 100}%`, height: `${selected.height / project.height * 100}%` } : null;

  if (!loaded) return <div className="h-full bg-neutral-950 text-neutral-400 grid place-items-center">Opening Artwork Studio…</div>;

  return <div className="h-full min-h-0 bg-[#0d0f11] text-white flex flex-col overflow-hidden">
    <input ref={importInputRef} type="file" accept="image/*" className="hidden" onChange={(e)=>{const f=e.target.files?.[0];if(f)void addImage(f,f.name);e.currentTarget.value=""}}/>
    <div className="h-8 shrink-0 border-b border-white/10 bg-[#101214] px-2 flex items-center text-[11px]">
      <div className="mr-3 px-2 font-semibold">Artwork Studio</div>
      {(["file","edit","image","layer","project","view"] as const).map(menu=><div key={menu} className="relative"><button onClick={()=>setMenuOpen(v=>v===menu?null:menu)} className={`px-2 py-1 rounded capitalize ${menuOpen===menu?"bg-white/10":"hover:bg-white/6"}`}>{menu}</button>{menuOpen===menu?<div className="absolute left-0 top-full z-[90] mt-1 min-w-52 rounded-lg border border-white/10 bg-[#15181b] p-1 shadow-2xl" onMouseLeave={()=>{}}>
        {menu==="file"?<><MenuItem label="New Project…" shortcut="Ctrl+N" onClick={()=>{setNewProjectDraft({title:"Untitled Artwork",artist:"",width:3000,height:3000,background:"#111111",format:"square"});setNewProjectOpen(true);setMenuOpen(null)}}/><MenuItem label="Save As…" onClick={()=>void saveAsProject()}/><MenuItem label="Import Image…" onClick={()=>{setMenuOpen(null);importInputRef.current?.click()}}/><div className="my-1 border-t border-white/10"/><div className="px-2 py-1 text-[9px] uppercase tracking-wider text-neutral-600">Open Recent</div>{recentProjects.slice(0,7).map(item=><MenuItem key={item.projectId} label={`${item.projectId===project.projectId?"✓ ":""}${item.title}`} meta={`${item.width}×${item.height}`} onClick={()=>void openRecentProject(item.projectId)}/>)}{!recentProjects.length?<div className="px-2 py-1.5 text-[10px] text-neutral-600">No saved projects yet</div>:null}<div className="my-1 border-t border-white/10"/><MenuItem label="Export Artwork…" onClick={()=>{setMenuOpen(null);void exportArtwork()}}/></>:null}
        {menu==="edit"?<><MenuItem label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={()=>{undo();setMenuOpen(null)}}/><MenuItem label="Redo" shortcut="Ctrl+Y" disabled={!canRedo} onClick={()=>{redo();setMenuOpen(null)}}/></>:null}
        {menu==="image"?<><MenuItem label="Image Size…" onClick={()=>{openImageSize();setMenuOpen(null)}}/><MenuItem label="Canvas Size" meta="Properties panel" onClick={()=>{setRightTab("properties");setMenuOpen(null)}}/>{selected?.kind==="image"?<><div className="my-1 border-t border-white/10"/><MenuItem label="Fit Layer to Canvas" onClick={()=>{placeSelectedImage("fit");setMenuOpen(null)}}/><MenuItem label="Fill Canvas / Crop" onClick={()=>{placeSelectedImage("fill");setMenuOpen(null)}}/><MenuItem label="Stretch to Canvas" onClick={()=>{placeSelectedImage("stretch");setMenuOpen(null)}}/></>:null}</>:null}
        {menu==="layer"?<><MenuItem label="Add Title Text" onClick={()=>{addText(project.title||"TITLE",Math.max(52,project.width*.07));setMenuOpen(null)}}/><MenuItem label="Add Artist Text" onClick={()=>{addText(project.artist||"ARTIST",Math.max(28,project.width*.035));setMenuOpen(null)}}/><div className="my-1 border-t border-white/10"/><MenuItem label="Duplicate Layer" disabled={!selected} onClick={()=>{duplicateSelected();setMenuOpen(null)}}/><MenuItem label="Delete Layer" disabled={!selected} onClick={()=>{removeSelected();setMenuOpen(null)}}/></>:null}
        {menu==="project"?<><MenuItem label="Use Saved Artist / Band Profile" onClick={()=>{void applyBandIdentity();setMenuOpen(null)}}/><div className="px-2 py-1.5 text-[9px] leading-relaxed text-neutral-600">Artist identity is project metadata, not a global YSong default.</div></>:null}
        {menu==="view"?<><MenuItem label="25%" onClick={()=>{setZoom(25);setMenuOpen(null)}}/><MenuItem label="50%" onClick={()=>{setZoom(50);setMenuOpen(null)}}/><MenuItem label="100%" shortcut="Ctrl+1" onClick={()=>{setZoom(100);setMenuOpen(null)}}/><MenuItem label="150%" onClick={()=>{setZoom(150);setMenuOpen(null)}}/></>:null}
      </div>:null}</div>)}
      <div className="ml-auto truncate px-2 text-[10px] text-neutral-500">{project.title||"Untitled Artwork"}{project.artist?` · ${project.artist}`:""} · {project.width}×{project.height}</div>
    </div>
    <div className="h-10 shrink-0 border-b border-white/10 bg-[#0d0f11] px-3 flex items-center gap-2 overflow-x-auto">
      <div className="text-[10px] uppercase tracking-wider text-neutral-600">{tool}</div><span className="divider"/>
      {tool==="select"&&selected?<><span className="text-[10px] text-neutral-400 truncate max-w-48">{selected.name}</span>{selected.kind==="image"?<><button className="topbtn" onClick={()=>placeSelectedImage("fit")}>Fit</button><button className="topbtn" onClick={()=>placeSelectedImage("fill")}>Fill</button><button className="topbtn" onClick={()=>placeSelectedImage("stretch")}>Stretch</button></>:null}</>:<span className="text-[10px] text-neutral-600">Choose a tool or select a layer</span>}
      <div className="ml-auto flex items-center gap-2"><label className="text-[11px] text-neutral-400 flex items-center gap-1">Zoom <input type="range" min="15" max="200" value={zoom} onChange={(e)=>setZoom(Number(e.target.value))} className="w-24"/><span className="w-10">{zoom}%</span></label><select value={exportType} onChange={(e)=>setExportType(e.target.value as "png"|"jpeg"|"webp")} className="topselect"><option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WEBP</option></select><button className="rounded-lg px-3 py-1.5 text-xs bg-cyan-500/20 border border-cyan-400/30" onClick={()=>void exportArtwork()}>Export</button></div>
    </div>

    <div className="flex-1 min-h-0 grid grid-cols-[58px_minmax(0,1fr)_330px]">
      <aside className="border-r border-white/10 bg-black/20 px-2 py-2 overflow-y-auto">
        <div className="space-y-1">{([
          ["select","Move"],["brush","Brush"],["pencil","Pencil"],["eraser","Eraser"],["text","Text"],["rect","Rectangle"],["ellipse","Ellipse"],["line","Line"],["crop","Crop"],["eyedropper","Eyedropper"],
        ] as [Tool,string][]).map(([id,label]) => <button key={id} aria-label={label} title={label} className={`w-10 h-10 mx-auto rounded-lg grid place-items-center border transition ${tool === id ? "bg-cyan-400/15 border-cyan-300/50 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,.08)]" : "border-transparent hover:bg-white/6 text-neutral-400 hover:text-neutral-100"}`} onClick={() => { setTool(id); if (id !== "crop") setCropRect(null); }}><ToolGlyph tool={id} /></button>)}</div>
        <div className="border-t border-white/10 mt-3 pt-3 space-y-2">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="block w-10 h-8 mx-auto bg-transparent" title="Foreground color" />
          <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="block w-10 h-8 mx-auto bg-transparent" title="Fill/background color" />
          <label className="block text-[8px] text-center text-neutral-500" title="Brush size">Size<input type="range" min="1" max="120" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-10" /></label>
          <label className="block text-[8px] text-center text-neutral-500" title="Brush opacity">Opacity<input type="range" min="5" max="100" value={Math.round(brushOpacity * 100)} onChange={(e) => setBrushOpacity(Number(e.target.value) / 100)} className="w-10" /></label>
        </div>
      </aside>

      <main ref={viewportRef} className="min-w-0 min-h-0 overflow-auto bg-[#171a1d] relative" style={{ backgroundImage: "linear-gradient(45deg,#202428 25%,transparent 25%),linear-gradient(-45deg,#202428 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#202428 75%),linear-gradient(-45deg,transparent 75%,#202428 75%)", backgroundSize: "24px 24px", backgroundPosition: "0 0,0 12px,12px -12px,-12px 0" }}>
        <div className="min-w-max min-h-full p-12 grid place-items-center">
          <div className="relative shadow-2xl" style={{ width: project.width * zoom / 100, height: project.height * zoom / 100 }}
            onDragEnter={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setCanvasDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) { e.dataTransfer.dropEffect = "copy"; setCanvasDragActive(true); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setCanvasDragActive(false); }}
            onDrop={(e) => { e.preventDefault(); setCanvasDragActive(false); const f = e.dataTransfer.files?.[0]; if (f) void addImage(f, f.name); }}>
            <canvas ref={canvasRef} className={`block w-full h-full ${tool === "select" ? "cursor-default" : tool === "eyedropper" ? "cursor-crosshair" : "cursor-crosshair"}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishGesture} onPointerCancel={finishGesture} />
            {canvasDragActive && <div className="pointer-events-none absolute inset-2 z-30 rounded-xl border-2 border-dashed border-cyan-300/80 bg-cyan-300/10 grid place-items-center shadow-[inset_0_0_40px_rgba(34,211,238,.08)]"><div className="rounded-xl border border-cyan-200/20 bg-black/75 px-4 py-3 text-center"><div className="text-sm font-semibold text-cyan-100">Drop image</div><div className="text-[10px] text-cyan-100/60 mt-1">Add as a new artwork layer</div></div></div>}
            {selectedStyle && tool === "select" && <div className="pointer-events-none absolute border border-cyan-300/80 shadow-[0_0_0_1px_rgba(0,0,0,.6)]" style={selectedStyle as React.CSSProperties}><span className="absolute -top-5 left-0 rounded bg-black/75 px-1.5 py-0.5 text-[9px] text-cyan-200 whitespace-nowrap">{selected?.name}</span></div>}
            {overlayRect && <div className={`pointer-events-none absolute border ${gesture?.kind === "crop" || cropRect ? "border-amber-300 bg-amber-300/5" : "border-cyan-300 bg-cyan-300/5"}`} style={{ left: `${overlayRect.x / project.width * 100}%`, top: `${overlayRect.y / project.height * 100}%`, width: `${overlayRect.width / project.width * 100}%`, height: `${overlayRect.height / project.height * 100}%` }} />}
          </div>
        </div>
        {cropRect && <div className="sticky bottom-4 mx-auto w-fit z-10 rounded-xl border border-amber-300/30 bg-black/85 p-2 flex items-center gap-2 text-xs"><span>Crop {Math.round(cropRect.width)}×{Math.round(cropRect.height)}</span><button className="rounded-lg bg-amber-300/20 border border-amber-300/30 px-2 py-1" onClick={applyCrop}>Apply Crop</button><button className="rounded-lg border border-white/10 px-2 py-1" onClick={() => { setCropRect(null); setTool("select"); }}>Cancel</button></div>}
      </main>

      <aside className="border-l border-white/10 bg-[#101214] min-h-0 flex flex-col">
        <div className="h-10 shrink-0 grid grid-cols-3 border-b border-white/10">{(["layers","properties","ai"] as const).map((tab) => <button key={tab} onClick={() => setRightTab(tab)} className={`text-[11px] uppercase tracking-wider ${rightTab === tab ? "bg-white/7 text-white" : "text-neutral-500"}`}>{tab}</button>)}</div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {rightTab === "layers" && <LayersPanel project={project} selectedLayerId={selectedLayerId} setSelectedLayerId={setSelectedLayerId} patchLayer={patchLayer} moveLayer={moveLayer} reorderLayers={reorderLayers} duplicateSelected={duplicateSelected} removeSelected={removeSelected} />}
          {rightTab === "properties" && <PropertiesPanel project={project} selected={selected} patchProject={patchProject} patchLayer={patchLayer} format={project.format} setFormat={setFormat} canvasSizeDraft={canvasSizeDraft} setCanvasSizeDraft={setCanvasSizeDraft} resizeCanvas={resizeCanvas} />}
          {rightTab === "ai" && <AiPanel project={project} patchProject={patchProject} busy={aiBusy} refine={refine} generate={generateArtwork} />}
        </div>
        <div className="shrink-0 border-t border-white/10 p-2 text-[10px] text-neutral-500 min-h-8">{status || "Drag images onto the canvas to add them as layers. Ctrl+C/V copies layers. Delete removes the selected layer."}</div>
      </aside>
    </div>
    {newProjectOpen && <div className="absolute inset-0 z-[95] grid place-items-center bg-black/65 p-4" onMouseDown={e=>{if(e.target===e.currentTarget)setNewProjectOpen(false)}}><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#151719] p-5 shadow-2xl"><div className="flex items-center justify-between"><div><div className="text-lg font-semibold">New Artwork Project</div><div className="mt-1 text-[10px] text-neutral-500">Creates a separate local project. Your current artwork remains in Open Recent.</div></div><button className="topbtn" onClick={()=>setNewProjectOpen(false)}>×</button></div><label className="lbl mt-4">Project Name<input className="prop" value={newProjectDraft.title} onChange={e=>setNewProjectDraft(d=>({...d,title:e.target.value}))}/></label><label className="lbl mt-3">Artist / Client<input className="prop" value={newProjectDraft.artist} onChange={e=>setNewProjectDraft(d=>({...d,artist:e.target.value}))} placeholder="Optional"/></label><div className="mt-4 grid grid-cols-3 gap-2">{[["square",3000,3000],["landscape",3840,2160],["portrait",2160,3840]].map(([format,w,h])=><button key={String(format)} onClick={()=>setNewProjectDraft(d=>({...d,format:format as ArtFormat,width:Number(w),height:Number(h)}))} className={`rounded-lg border p-2 text-left ${newProjectDraft.format===format?"border-cyan-400/40 bg-cyan-500/10":"border-white/10 bg-white/[.02]"}`}><div className="text-xs font-semibold capitalize">{String(format)}</div><div className="mt-1 text-[9px] text-neutral-500">{w}×{h}</div></button>)}</div><div className="mt-4 grid grid-cols-2 gap-2"><label className="lbl">Width<input className="prop" type="number" min="64" max="8192" value={newProjectDraft.width} onChange={e=>setNewProjectDraft(d=>({...d,format:"custom",width:Number(e.target.value)||64}))}/></label><label className="lbl">Height<input className="prop" type="number" min="64" max="8192" value={newProjectDraft.height} onChange={e=>setNewProjectDraft(d=>({...d,format:"custom",height:Number(e.target.value)||64}))}/></label></div><label className="lbl mt-3">Background<input type="color" className="ml-2 h-8 w-12 align-middle bg-transparent" value={newProjectDraft.background} onChange={e=>setNewProjectDraft(d=>({...d,background:e.target.value}))}/></label><div className="mt-5 flex justify-end gap-2"><button className="topbtn" onClick={()=>setNewProjectOpen(false)}>Cancel</button><button className="rounded-lg border border-cyan-400/30 bg-cyan-500/20 px-4 py-2 text-xs" onClick={createNewProject}>Create Project</button></div></div></div>}
    {imageSizeOpen && <div className="absolute inset-0 z-[80] grid place-items-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setImageSizeOpen(false); }}><div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151719] p-5 shadow-2xl"><div className="flex items-center justify-between"><div><div className="text-lg font-semibold">Image Size</div><div className="mt-1 text-[10px] text-neutral-500">Resize the whole artwork and scale every layer with it.</div></div><button className="topbtn" onClick={() => setImageSizeOpen(false)}>×</button></div><div className="mt-5 grid grid-cols-[1fr_44px_1fr] items-end gap-2"><label className="lbl">Width<input className="prop" type="number" min="64" max="8192" value={imageSizeDraft.width} onChange={(e) => { const width=Math.round(clamp(Number(e.target.value)||64,64,8192)); setImageSizeDraft((d)=>({ ...d,width,height:d.linked?Math.max(64,Math.round(width*project.height/Math.max(1,project.width))):d.height })); }} /></label><button className={`mb-1 h-9 rounded-lg border text-sm ${imageSizeDraft.linked?"border-cyan-400/40 bg-cyan-500/10 text-cyan-300":"border-white/10 text-neutral-500"}`} onClick={() => setImageSizeDraft((d)=>({...d,linked:!d.linked}))} title="Constrain proportions">🔗</button><label className="lbl">Height<input className="prop" type="number" min="64" max="8192" value={imageSizeDraft.height} onChange={(e) => { const height=Math.round(clamp(Number(e.target.value)||64,64,8192)); setImageSizeDraft((d)=>({ ...d,height,width:d.linked?Math.max(64,Math.round(height*project.width/Math.max(1,project.height))):d.width })); }} /></label></div><label className="lbl mt-4">Resample<select className="prop" value={imageSizeDraft.resampleMode} onChange={(e)=>setImageSizeDraft((d)=>({...d,resampleMode:e.target.value as ResampleMode}))}><option value="automatic">Automatic</option><option value="preserve-details">Preserve Details</option><option value="bicubic-smoother">Bicubic Smoother (enlargement)</option><option value="bicubic-sharper">Bicubic Sharper (reduction)</option><option value="bicubic">Bicubic</option><option value="bilinear">Bilinear</option><option value="nearest">Nearest Neighbor</option></select></label><div className="mt-2 text-[10px] leading-relaxed text-neutral-500">High-quality modes use the browser's best available image interpolation while YSong keeps the original source blob intact, so Undo and later resizing remain non-destructive.</div><div className="mt-5 flex justify-end gap-2"><button className="topbtn" onClick={() => setImageSizeOpen(false)}>Cancel</button><button className="rounded-lg border border-cyan-400/30 bg-cyan-500/20 px-4 py-2 text-xs" onClick={applyImageSize}>Resize</button></div></div></div>}
    <style>{`.topbtn{border:1px solid rgba(255,255,255,.1);border-radius:.5rem;padding:.35rem .55rem;font-size:11px;white-space:nowrap}.topbtn:hover{background:rgba(255,255,255,.06)}.topbtn:disabled{opacity:.3}.topselect{background:#111418;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;padding:.35rem .45rem;font-size:11px}.divider{height:22px;width:1px;background:rgba(255,255,255,.1);margin:0 4px}.prop{width:100%;background:#090b0d;border:1px solid rgba(255,255,255,.1);border-radius:.5rem;padding:.4rem .5rem;outline:none;font-size:12px}.prop:focus{border-color:rgba(103,232,249,.45)}`}</style>
  </div>;
}

function MenuItem({label,shortcut,meta,disabled=false,onClick}:{label:string;shortcut?:string;meta?:string;disabled?:boolean;onClick:()=>void}){return <button disabled={disabled} onClick={onClick} className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-[11px] hover:bg-white/[.07] disabled:opacity-30"><span className="min-w-0 flex-1 truncate">{label}</span>{meta?<span className="text-[9px] text-neutral-600">{meta}</span>:null}{shortcut?<span className="text-[9px] text-neutral-600">{shortcut}</span>:null}</button>}

function ToolGlyph({ tool }: { tool: Tool }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (tool === "select") return <svg {...common}><path d="M5 3l13 8-6 2-3 6z" /></svg>;
  if (tool === "brush") return <svg {...common}><path d="M14 5l5-2 2 2-2 5-9 9c-2 2-5 2-7 2 0-2 0-5 2-7z" /><path d="M13 6l5 5" /></svg>;
  if (tool === "pencil") return <svg {...common}><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></svg>;
  if (tool === "eraser") return <svg {...common}><path d="M4 15l8-10 7 6-7 9H8z" /><path d="M10 20h10" /></svg>;
  if (tool === "text") return <svg {...common}><path d="M5 5h14M12 5v14M8 19h8" /></svg>;
  if (tool === "rect") return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="1" /></svg>;
  if (tool === "ellipse") return <svg {...common}><ellipse cx="12" cy="12" rx="8" ry="6" /></svg>;
  if (tool === "line") return <svg {...common}><path d="M5 19L19 5" /></svg>;
  if (tool === "crop") return <svg {...common}><path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h14a2 2 0 0 1 2 2v12" /></svg>;
  return <svg {...common}><path d="M5 19l9-9 4 4-9 9H5z" /><path d="M13 11l-2-2 5-5 4 4-5 5" /></svg>;
}

function LayerKindGlyph({ kind }: { kind: ArtLayer["kind"] }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "image") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M4 16l5-5 4 4 2-2 5 5" /><circle cx="16.5" cy="8.5" r="1.5" /></svg>;
  if (kind === "text") return <svg {...common}><path d="M5 5h14M12 5v14M8 19h8" /></svg>;
  if (kind === "shape") return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
  return <svg {...common}><path d="M4 17c3-1 4-5 7-7s5 1 4 3-4 2-4 5c0 2 3 2 6 0" /></svg>;
}

function LayersPanel({ project, selectedLayerId, setSelectedLayerId, patchLayer, moveLayer, reorderLayers, duplicateSelected, removeSelected }: { project: ArtworkProject; selectedLayerId: string | null; setSelectedLayerId: (id: string | null) => void; patchLayer: (id: string, patch: Partial<ArtLayer>, history?: boolean) => void; moveLayer: (d: number) => void; reorderLayers: (displayOrderIds: string[]) => void; duplicateSelected: () => void; removeSelected: () => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const displayLayers = [...project.layers].reverse();

  const beginDrag = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id);
    setSelectedLayerId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    const ghost = document.createElement("canvas");
    ghost.width = 1; ghost.height = 1;
    ghost.style.position = "fixed"; ghost.style.left = "-10px"; ghost.style.top = "-10px";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    window.setTimeout(() => ghost.remove(), 0);
  };

  const finishDrop = (targetId: string, side: "before" | "after") => {
    if (!draggingId || draggingId === targetId) { setDropTarget(null); return; }
    const ids = displayLayers.map((layer) => layer.id);
    const from = ids.indexOf(draggingId);
    if (from < 0) { setDropTarget(null); return; }
    ids.splice(from, 1);
    const target = ids.indexOf(targetId);
    if (target < 0) { setDropTarget(null); return; }
    ids.splice(target + (side === "after" ? 1 : 0), 0, draggingId);
    reorderLayers(ids);
    setDropTarget(null);
  };

  const placeholder = <div className="h-11 rounded-lg border border-cyan-300/55 bg-cyan-300/8 shadow-[inset_0_0_18px_rgba(34,211,238,.06)]" aria-hidden="true" />;

  return <div>
    <div className="flex items-center justify-between gap-2 mb-3"><div><div className="text-xs font-semibold">Layers</div><div className="text-[9px] text-neutral-500 mt-0.5">Drag layers to reorder</div></div><div className="flex gap-1"><button className="topbtn" title="Move selected layer up" onClick={() => moveLayer(1)}>↑</button><button className="topbtn" title="Move selected layer down" onClick={() => moveLayer(-1)}>↓</button></div></div>
    <div className="space-y-1.5">
      {displayLayers.map((layer) => <div key={layer.id}>
        {dropTarget?.id === layer.id && dropTarget.side === "before" && placeholder}
        <div
          draggable
          onDragStart={(e) => beginDrag(e, layer.id)}
          onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
          onDragOver={(e) => {
            if (!draggingId || draggingId === layer.id) return;
            e.preventDefault(); e.dataTransfer.dropEffect = "move";
            const rect = e.currentTarget.getBoundingClientRect();
            setDropTarget({ id: layer.id, side: e.clientY < rect.top + rect.height / 2 ? "before" : "after" });
          }}
          onDrop={(e) => { e.preventDefault(); if (dropTarget?.id === layer.id) finishDrop(layer.id, dropTarget.side); }}
          onClick={() => setSelectedLayerId(layer.id)}
          className={`rounded-lg border p-2 flex items-center gap-2 cursor-grab active:cursor-grabbing transition ${draggingId === layer.id ? "opacity-30 border-cyan-300/20" : selectedLayerId === layer.id ? "border-cyan-300/45 bg-cyan-300/8" : "border-white/8 hover:bg-white/4"}`}
        >
          <span className="w-3 text-neutral-600 text-[10px]" aria-hidden="true">⋮⋮</span>
          <button type="button" title="Toggle visibility" onClick={(e) => { e.stopPropagation(); patchLayer(layer.id, { visible: !layer.visible } as Partial<ArtLayer>); }} className="w-6 text-xs">{layer.visible ? "◉" : "○"}</button>
          <div className="h-9 w-11 shrink-0 rounded-md border border-white/10 bg-white/5 grid place-items-center overflow-hidden"><LayerKindGlyph kind={layer.kind} /></div>
          <div className="min-w-0 flex-1"><div className="text-xs truncate">{layer.name}</div><div className="text-[9px] text-neutral-500 uppercase">{layer.kind}</div></div>
          <button type="button" title={layer.locked ? "Unlock layer" : "Lock layer"} onClick={(e) => { e.stopPropagation(); patchLayer(layer.id, { locked: !layer.locked } as Partial<ArtLayer>); }} className="w-6 text-xs">{layer.locked ? "🔒" : "·"}</button>
        </div>
        {dropTarget?.id === layer.id && dropTarget.side === "after" && placeholder}
      </div>)}
    </div>
    {!project.layers.length && <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-neutral-500">No layers yet. Import or drag an image, add text, draw, or create a shape.</div>}
    <div className="mt-3 flex gap-2"><button className="topbtn" onClick={duplicateSelected} disabled={!selectedLayerId}>Duplicate</button><button className="topbtn text-red-300" onClick={removeSelected} disabled={!selectedLayerId}>Delete</button></div>
  </div>;
}

function PropertiesPanel({ project, selected, patchProject, patchLayer, format, setFormat, canvasSizeDraft, setCanvasSizeDraft, resizeCanvas }: { project: ArtworkProject; selected: ArtLayer | null; patchProject: (p: Partial<ArtworkProject>) => void; patchLayer: (id: string, p: Partial<ArtLayer>, history?: boolean) => void; format: ArtFormat; setFormat: (f: ArtFormat) => void; canvasSizeDraft: { width: number; height: number }; setCanvasSizeDraft: React.Dispatch<React.SetStateAction<{ width: number; height: number }>>; resizeCanvas: () => void }) {
  const n = (v: string, fallback: number) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  return <div className="space-y-4">
    <section><div className="text-xs font-semibold mb-2">Canvas</div><label className="lbl">Preset<select className="prop" value={format} onChange={(e) => setFormat(e.target.value as ArtFormat)}><option value="square">Square 1000×1000</option><option value="landscape">Landscape 1600×900</option><option value="portrait">Portrait 1000×1250</option><option value="custom">Custom</option></select></label><div className="grid grid-cols-2 gap-2 mt-2"><label className="lbl">Width<input className="prop" type="number" value={canvasSizeDraft.width} onChange={(e) => setCanvasSizeDraft((d) => ({ ...d, width: n(e.target.value, d.width) }))} /></label><label className="lbl">Height<input className="prop" type="number" value={canvasSizeDraft.height} onChange={(e) => setCanvasSizeDraft((d) => ({ ...d, height: n(e.target.value, d.height) }))} /></label></div><button className="topbtn mt-2" onClick={resizeCanvas}>Resize Canvas</button><label className="lbl mt-2">Background<input type="color" value={project.background} onChange={(e) => patchProject({ background: e.target.value })} className="w-full h-9 bg-transparent" /></label></section>
    {selected ? <section className="border-t border-white/10 pt-4 space-y-3"><div className="text-xs font-semibold">Selected layer</div><label className="lbl">Name<input className="prop" value={selected.name} onChange={(e) => patchLayer(selected.id, { name: e.target.value } as Partial<ArtLayer>)} /></label><div className="grid grid-cols-2 gap-2"><label className="lbl">X<input className="prop" type="number" value={Math.round(selected.x)} onChange={(e) => patchLayer(selected.id, { x: n(e.target.value, selected.x) } as Partial<ArtLayer>)} /></label><label className="lbl">Y<input className="prop" type="number" value={Math.round(selected.y)} onChange={(e) => patchLayer(selected.id, { y: n(e.target.value, selected.y) } as Partial<ArtLayer>)} /></label><label className="lbl">Width<input className="prop" type="number" min="1" value={Math.round(selected.width)} onChange={(e) => patchLayer(selected.id, { width: Math.max(1, n(e.target.value, selected.width)) } as Partial<ArtLayer>)} /></label><label className="lbl">Height<input className="prop" type="number" min="1" value={Math.round(selected.height)} onChange={(e) => patchLayer(selected.id, { height: Math.max(1, n(e.target.value, selected.height)) } as Partial<ArtLayer>)} /></label></div><label className="lbl">Rotation<input className="prop" type="number" value={Math.round(selected.rotation)} onChange={(e) => patchLayer(selected.id, { rotation: n(e.target.value, selected.rotation) } as Partial<ArtLayer>)} /></label><div className="flex gap-2"><button className="topbtn" onClick={() => patchLayer(selected.id, { flipX: !selected.flipX } as Partial<ArtLayer>)}>Flip H</button><button className="topbtn" onClick={() => patchLayer(selected.id, { flipY: !selected.flipY } as Partial<ArtLayer>)}>Flip V</button></div><label className="lbl">Opacity {Math.round(selected.opacity * 100)}%<input type="range" min="0" max="100" value={Math.round(selected.opacity * 100)} onChange={(e) => patchLayer(selected.id, { opacity: Number(e.target.value) / 100 } as Partial<ArtLayer>)} className="w-full" /></label><label className="lbl">Blend<select className="prop" value={selected.blendMode} onChange={(e) => patchLayer(selected.id, { blendMode: e.target.value as BlendMode } as Partial<ArtLayer>)}><option value="source-over">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="darken">Darken</option><option value="lighten">Lighten</option></select></label>
      {selected.kind === "text" && <><label className="lbl">Text<textarea className="prop min-h-24" value={selected.text} onChange={(e) => patchLayer(selected.id, { text: e.target.value } as Partial<ArtLayer>)} /></label><div className="grid grid-cols-2 gap-2"><label className="lbl">Size<input className="prop" type="number" value={selected.fontSize} onChange={(e) => patchLayer(selected.id, { fontSize: Math.max(4, n(e.target.value, selected.fontSize)) } as Partial<ArtLayer>)} /></label><label className="lbl">Weight<select className="prop" value={selected.fontWeight} onChange={(e) => patchLayer(selected.id, { fontWeight: e.target.value as TextLayer["fontWeight"] } as Partial<ArtLayer>)}><option value="400">Regular</option><option value="600">Semi-bold</option><option value="700">Bold</option><option value="900">Black</option></select></label></div><label className="lbl">Font<input className="prop" value={selected.fontFamily} onChange={(e) => patchLayer(selected.id, { fontFamily: e.target.value } as Partial<ArtLayer>)} /></label><label className="lbl">Color<input type="color" value={selected.color} onChange={(e) => patchLayer(selected.id, { color: e.target.value } as Partial<ArtLayer>)} className="w-full h-9 bg-transparent" /></label><label className="lbl">Align<select className="prop" value={selected.align} onChange={(e) => patchLayer(selected.id, { align: e.target.value as TextLayer["align"] } as Partial<ArtLayer>)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></>}
      {selected.kind === "image" && <><div className="grid grid-cols-2 gap-2"><Adj label="Brightness" value={selected.brightness} onChange={(v) => patchLayer(selected.id, { brightness: v } as Partial<ArtLayer>)} /><Adj label="Contrast" value={selected.contrast} onChange={(v) => patchLayer(selected.id, { contrast: v } as Partial<ArtLayer>)} /><Adj label="Saturation" value={selected.saturation} onChange={(v) => patchLayer(selected.id, { saturation: v } as Partial<ArtLayer>)} /><label className="lbl">Hue<input className="prop" type="number" min="-180" max="180" value={selected.hue} onChange={(e) => patchLayer(selected.id, { hue: clamp(n(e.target.value, selected.hue), -180, 180) } as Partial<ArtLayer>)} /></label></div><label className="lbl">Blur {selected.blur.toFixed(1)}px<input type="range" min="0" max="30" step="0.5" value={selected.blur} onChange={(e) => patchLayer(selected.id, { blur: Number(e.target.value) } as Partial<ArtLayer>)} className="w-full" /></label></>}
      {selected.kind === "shape" && <><label className="lbl">Fill<input type="color" value={selected.fill === "transparent" ? "#000000" : selected.fill} onChange={(e) => patchLayer(selected.id, { fill: e.target.value } as Partial<ArtLayer>)} className="w-full h-9 bg-transparent" /></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.fill === "transparent"} onChange={(e) => patchLayer(selected.id, { fill: e.target.checked ? "transparent" : "#111111" } as Partial<ArtLayer>)} /> No fill</label><label className="lbl">Stroke<input type="color" value={selected.stroke} onChange={(e) => patchLayer(selected.id, { stroke: e.target.value } as Partial<ArtLayer>)} className="w-full h-9 bg-transparent" /></label><label className="lbl">Stroke width<input className="prop" type="number" value={selected.strokeWidth} onChange={(e) => patchLayer(selected.id, { strokeWidth: Math.max(0, n(e.target.value, selected.strokeWidth)) } as Partial<ArtLayer>)} /></label></>}
    </section> : <div className="border-t border-white/10 pt-4 text-xs text-neutral-500">Select a layer to edit position, size, rotation, opacity, blend mode, text, image adjustments, or shape properties.</div>}
    <style>{`.lbl{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#737373;margin-top:.35rem}.lbl>.prop,.lbl>textarea{margin-top:.3rem;color:#eee;text-transform:none;letter-spacing:0}`}</style>
  </div>;
}

function Adj({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) { return <label className="lbl">{label}<input className="prop" type="number" min="0" max="300" value={Math.round(value)} onChange={(e) => onChange(clamp(Number(e.target.value || value), 0, 300))} /></label>; }

function AiPanel({ project, patchProject, busy, refine, generate }: { project: ArtworkProject; patchProject: (p: Partial<ArtworkProject>) => void; busy: "refine" | "generate" | null; refine: () => void; generate: () => void }) {
  const hasBrief = !!(project.direction.trim() || project.prompt.trim());
  return <div className="space-y-3"><div><div className="text-xs font-semibold">Release brief + AI</div><div className="text-[10px] text-neutral-500 mt-1">Refine a prompt, generate an image, then keep editing it with the normal layer tools.</div></div>{busy === "generate" ? <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-3 text-[10px] text-fuchsia-100"><div className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-300"/>Generating artwork…</div><div className="mt-1 text-fuchsia-100/60">Only one generation can run at a time. Existing layers are preserved.</div></div> : null}<label className="lbl">Release title<input className="prop" value={project.title} onChange={(e) => patchProject({ title: e.target.value })} /></label><label className="lbl">Artist / band<input className="prop" value={project.artist} onChange={(e) => patchProject({ artist: e.target.value })} /></label><label className="lbl">Art direction<textarea className="prop min-h-28" value={project.direction} onChange={(e) => patchProject({ direction: e.target.value })} placeholder="Scene, symbolism, palette, mood, typography…" /></label><label className="lbl">Generation prompt<textarea className="prop min-h-36" value={project.prompt} onChange={(e) => patchProject({ prompt: e.target.value })} /></label><div className="flex flex-wrap gap-2"><button className="rounded-xl px-3 py-2 text-xs bg-cyan-500/20 border border-cyan-400/30 disabled:opacity-30" disabled={!!busy || !hasBrief} onClick={refine}>{busy === "refine" ? "Refining…" : "Refine with YSong AI"}</button><button disabled={!!busy || !hasBrief} onClick={generate} className="rounded-xl px-3 py-2 text-xs border border-fuchsia-400/30 bg-fuchsia-500/15 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-30">{busy === "generate" ? "Generating…" : "Generate Artwork"}</button></div><div className="text-[9px] leading-relaxed text-neutral-600">Artwork generation runs server-side and reuses YSong's configured OpenAI key by default. Generated art is added as a new editable layer instead of replacing the current project.</div></div>;
}
