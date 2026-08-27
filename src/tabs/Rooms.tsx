import { useEffect, useMemo, useRef, useState } from "react";
import type { TabRecord } from "./core";
import Avatar from "../components/Avatar";
import {
  createRoom,
  deleteRoom,
  getRoom,
  inviteRoomMember,
  joinRoom,
  leaveRoom,
  listRooms,
  removeRoomPersona,
  requestRoomAi,
  sendRoomMessage,
  setRoomPersonaMode,
  updateRoom,
  type RoomDetail,
  type RoomMessage,
  type RoomPersona,
  type RoomSummary,
} from "../lib/roomApi";

type Props = { tab: TabRecord; meUserId?: string; meAvatarUrl?: string; meDisplayName?: string };

function Icon({ name, size = 18 }: { name: "plus" | "lock" | "globe" | "users" | "bot" | "refresh" | "trash"; size?: number }) {
  const c = { width:size, height:size, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:1.8, strokeLinecap:"round" as const, strokeLinejoin:"round" as const };
  const p = {
    plus:<><path d="M12 5v14M5 12h14"/></>, lock:<><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    users:<><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5 5"/></>,
    bot:<><rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 15h6"/></>,
    refresh:<><path d="M20 6v5h-5M4 18v-5h5"/><path d="M18 9a7 7 0 0 0-12-2M6 15a7 7 0 0 0 12 2"/></>,
    trash:<><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
  } as const;
  return <svg {...c}>{p[name]}</svg>;
}

function mergeMessages(current: RoomMessage[], incoming: RoomMessage[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  incoming.forEach((m) => byId.set(m.id, m));
  return [...byId.values()].sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function RoomCreateModal({ onClose, onCreated }: { onClose:()=>void; onCreated:(r:RoomSummary)=>void }) {
  const [name,setName]=useState(""); const [description,setDescription]=useState(""); const [visibility,setVisibility]=useState<"public"|"private">("private"); const [saving,setSaving]=useState(false); const [error,setError]=useState("");
  async function save(){ if(!name.trim()){setError("Room name required.");return;} setSaving(true);setError(""); try{const r=await createRoom({name:name.trim(),description:description.trim(),visibility});onCreated(r.room);}catch(e:any){setError(e?.message||"Could not create room.");}finally{setSaving(false);} }
  return <div className="fixed inset-0 z-[135] bg-black/65 backdrop-blur-sm grid place-items-center p-4" onMouseDown={(e)=>e.target===e.currentTarget&&onClose()}><div className="w-full max-w-lg rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 shadow-2xl p-5">
    <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">Create Room</h2><p className="text-xs opacity-60 mt-1">Humans and AI personas can share the same persistent studio chat.</p></div><button className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose}>×</button></div>
    <div className="grid gap-4 mt-5"><label className="text-xs font-medium">Room name<input className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm" value={name} maxLength={100} onChange={(e)=>setName(e.target.value)} placeholder="Astra Studio"/></label><label className="text-xs font-medium">Description<textarea className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2 text-sm resize-y" rows={3} value={description} maxLength={800} onChange={(e)=>setDescription(e.target.value)} placeholder="What is this room for?"/></label>
      <div><div className="text-xs font-medium mb-2">Visibility</div><div className="grid grid-cols-2 gap-2"><button onClick={()=>setVisibility("private")} className={`rounded-xl border p-3 text-left ${visibility==="private"?"border-violet-500 bg-violet-500/10":""}`}><div className="flex items-center gap-2 text-sm font-medium"><Icon name="lock"/>Private</div><div className="text-[11px] opacity-55 mt-1">Members only.</div></button><button onClick={()=>setVisibility("public")} className={`rounded-xl border p-3 text-left ${visibility==="public"?"border-violet-500 bg-violet-500/10":""}`}><div className="flex items-center gap-2 text-sm font-medium"><Icon name="globe"/>Public</div><div className="text-[11px] opacity-55 mt-1">Discoverable and joinable.</div></button></div></div>
      {error&&<div className="text-sm text-red-500">{error}</div>}<div className="flex justify-end gap-2"><button className="px-4 py-2 rounded-xl border" onClick={onClose}>Cancel</button><button disabled={saving} className="px-4 py-2 rounded-xl bg-violet-600 text-white disabled:opacity-50" onClick={save}>{saving?"Creating...":"Create Room"}</button></div></div>
  </div></div>;
}

export default function RoomsPane({ meUserId, meAvatarUrl, meDisplayName }: Props) {
  const [rooms,setRooms]=useState<RoomSummary[]>([]); const [activeRoomId,setActiveRoomId]=useState(()=>{try{return localStorage.getItem("ysong:activeRoomId")||"";}catch{return"";}}); const [detail,setDetail]=useState<RoomDetail|null>(null); const [input,setInput]=useState(""); const [aiThinking,setAiThinking]=useState(false); const [createOpen,setCreateOpen]=useState(false); const [error,setError]=useState(""); const [inviteName,setInviteName]=useState(""); const [inviteBusy,setInviteBusy]=useState(false); const bottomRef=useRef<HTMLDivElement|null>(null);

  async function refreshRooms(preferId?:string){try{const data=await listRooms();setRooms(data.rooms||[]);const wanted=preferId||activeRoomId;const valid=(data.rooms||[]).find(r=>r.id===wanted);const firstJoined=(data.rooms||[]).find(r=>r.joined);const firstPublic=(data.rooms||[])[0];const next=valid?.id||firstJoined?.id||firstPublic?.id||"";if(next&&next!==activeRoomId)setActiveRoomId(next);}catch(e:any){setError(e?.message||"Could not load rooms.");}}
  async function refreshDetail(roomId=activeRoomId){if(!roomId){setDetail(null);return;}try{const d=await getRoom(roomId);setDetail(d);setRooms(prev=>prev.map(r=>r.id===d.room.id?d.room:r));}catch(e:any){setError(e?.message||"Could not load room.");}}
  useEffect(()=>{void refreshRooms();},[]);
  useEffect(()=>{if(!activeRoomId){setDetail(null);return;}try{localStorage.setItem("ysong:activeRoomId",activeRoomId);}catch{} window.dispatchEvent(new CustomEvent("ysong:active-room-changed",{detail:{roomId:activeRoomId}}));void refreshDetail(activeRoomId);},[activeRoomId]);
  useEffect(()=>{if(!activeRoomId)return;const timer=setInterval(()=>void refreshDetail(activeRoomId),3000);return()=>clearInterval(timer);},[activeRoomId]);
  useEffect(()=>{const f=()=>void refreshDetail();window.addEventListener("ysong:room-personas-changed",f);return()=>window.removeEventListener("ysong:room-personas-changed",f);},[activeRoomId]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({block:"nearest"});},[detail?.messages.length,aiThinking]);

  const joinedRooms=useMemo(()=>rooms.filter(r=>r.joined),[rooms]); const publicRooms=useMemo(()=>rooms.filter(r=>!r.joined&&r.visibility==="public"),[rooms]);
  function openPersonaDrawer(){window.dispatchEvent(new CustomEvent("ysong:open-drawer",{detail:{id:"personas"}}));}
  async function send(){const text=input.trim();if(!text||!detail?.room.joined)return;setInput("");setError("");try{const saved=await sendRoomMessage(detail.room.id,text);setDetail(d=>d?{...d,messages:mergeMessages(d.messages,[saved.message])}:d);setAiThinking(true);void requestRoomAi(detail.room.id,text).then(async result=>{for(const m of result.messages||[]){await new Promise(r=>setTimeout(r,Math.min(1500,450+Math.random()*700)));setDetail(d=>d?{...d,messages:mergeMessages(d.messages,[m])}:d);}}).catch((e:any)=>setError(e?.message||"Room AI reply failed.")).finally(()=>setAiThinking(false));}catch(e:any){setError(e?.message||"Could not send message.");}}
  async function doJoin(){if(!detail)return;await joinRoom(detail.room.id);await refreshRooms(detail.room.id);await refreshDetail(detail.room.id);}
  async function doInvite(){if(!detail||!inviteName.trim())return;setInviteBusy(true);try{await inviteRoomMember(detail.room.id,inviteName.trim());setInviteName("");await refreshDetail();}catch(e:any){setError(e?.message||"Could not add member.");}finally{setInviteBusy(false);}}
  async function changeMode(p:RoomPersona,mode:RoomPersona["participationMode"]){if(!detail)return;await setRoomPersonaMode(detail.room.id,p.id,mode);await refreshDetail();}
  async function removePersona(p:RoomPersona){if(!detail)return;await removeRoomPersona(detail.room.id,p.id);window.dispatchEvent(new Event("ysong:room-personas-changed"));await refreshDetail();}

  return <div className="h-full min-h-0 flex bg-neutral-50/40 dark:bg-neutral-950/20">
    <aside className="w-[230px] shrink-0 border-r border-neutral-200 dark:border-neutral-800 min-h-0 flex flex-col">
      <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between"><div><div className="text-sm font-semibold">Rooms</div><div className="text-[10px] opacity-50">Humans + AI</div></div><button onClick={()=>setCreateOpen(true)} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/10" title="Create room"><Icon name="plus"/></button></div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4"><div><div className="px-2 text-[10px] uppercase tracking-[.12em] opacity-45 mb-1">Your rooms</div>{joinedRooms.length?joinedRooms.map(r=><button key={r.id} onClick={()=>setActiveRoomId(r.id)} className={`w-full rounded-xl p-2.5 text-left mb-1 ${activeRoomId===r.id?"bg-violet-500/12 text-violet-700 dark:text-violet-200":"hover:bg-black/5 dark:hover:bg-white/5"}`}><div className="flex items-center gap-2"><span className="opacity-55">{r.visibility==="private"?<Icon name="lock" size={13}/>:<Icon name="globe" size={13}/>}</span><span className="text-sm font-medium truncate">{r.name}</span></div><div className="text-[10px] opacity-45 mt-1 truncate">{r.description||r.role}</div></button>):<div className="px-2 py-3 text-xs opacity-45">No rooms yet.</div>}</div>
        {publicRooms.length>0&&<div><div className="px-2 text-[10px] uppercase tracking-[.12em] opacity-45 mb-1">Public rooms</div>{publicRooms.map(r=><button key={r.id} onClick={()=>setActiveRoomId(r.id)} className={`w-full rounded-xl p-2.5 text-left mb-1 ${activeRoomId===r.id?"bg-violet-500/12":"hover:bg-black/5 dark:hover:bg-white/5"}`}><div className="flex items-center gap-2"><Icon name="globe" size={13}/><span className="text-sm truncate">{r.name}</span></div></button>)}</div>}
      </div>
    </aside>

    <section className="flex-1 min-w-0 min-h-0 flex flex-col">
      {!detail?<div className="h-full grid place-items-center text-center p-8"><div><div className="text-4xl mb-3">💬</div><h2 className="text-lg font-semibold">Create a YSong Room</h2><p className="text-sm opacity-55 max-w-md mt-1">Persistent rooms can hold multiple humans and multiple AI personas.</p><button onClick={()=>setCreateOpen(true)} className="mt-4 rounded-xl bg-violet-600 text-white px-4 py-2 text-sm">Create Room</button></div></div>:<>
        <header className="h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-800 px-4 flex items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="opacity-50">{detail.room.visibility==="private"?<Icon name="lock" size={15}/>:<Icon name="globe" size={15}/>}</span><h2 className="font-semibold truncate">{detail.room.name}</h2></div><div className="text-[11px] opacity-50 truncate">{detail.room.description||"YSong studio room"}</div></div><div className="flex gap-2"><button onClick={openPersonaDrawer} className="rounded-xl border px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5"><Icon name="bot" size={14}/>Add AI</button><button onClick={()=>void refreshDetail()} className="h-8 w-8 rounded-lg border grid place-items-center" title="Refresh"><Icon name="refresh" size={14}/></button></div></header>
        {!detail.room.joined?<div className="flex-1 grid place-items-center"><div className="text-center max-w-md px-6"><h3 className="text-xl font-semibold">Public room</h3><p className="text-sm opacity-55 mt-2">Join to send messages and add AI personas.</p><button onClick={()=>void doJoin()} className="mt-4 bg-violet-600 text-white rounded-xl px-5 py-2">Join Room</button></div></div>:<>
          <div className="flex-1 min-h-0 overflow-y-auto"><div className="mx-auto max-w-[760px] px-4 sm:px-6 py-5 space-y-4">{detail.messages.map(m=>{const isMe=m.senderKind==="user"&&m.senderUserId===meUserId;const isAi=m.senderKind==="persona";const avatar=isAi?m.personaAvatarPath:(isMe?meAvatarUrl:"");return <div key={m.id} className={`flex items-end gap-2 ${isMe?"justify-end":"justify-start"}`}>{!isMe&&<Avatar src={avatar} name={m.senderName} size={34}/>}<div className={`max-w-[76%] min-w-0 ${isMe?"items-end":"items-start"} flex flex-col`}><div className="text-[10px] opacity-45 mb-1 px-1">{isMe?meDisplayName||"You":m.senderName}{isAi&&<span className="ml-1.5 rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-wide">AI</span>}</div><div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${isMe?"bg-neutral-800 text-white dark:bg-neutral-700":"bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"}`}>{m.content}</div></div>{isMe&&<Avatar src={meAvatarUrl} name={meDisplayName||"You"} size={34}/>}</div>})}{aiThinking&&<div className="flex items-center gap-2 text-xs opacity-50"><span className="inline-flex gap-1"><i className="h-1.5 w-1.5 rounded-full bg-current animate-bounce"/><i className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:120ms]"/><i className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:240ms]"/></span>AI personas are deciding whether to jump in...</div>}<div ref={bottomRef}/></div></div>
          <div className="shrink-0 border-t border-neutral-200 dark:border-neutral-800"><div className="mx-auto max-w-[760px] px-4 sm:px-6 py-3 pb-12"><div className="rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/70 px-2 py-1.5 flex items-end gap-2"><textarea rows={1} value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder={`Message #${detail.room.name}...`} className="flex-1 min-h-9 max-h-32 resize-none bg-transparent border-0 px-2 py-2 text-sm focus:outline-none"/><button disabled={!input.trim()} onClick={()=>void send()} className="rounded-xl bg-violet-600 text-white px-4 h-9 text-sm disabled:opacity-35">Send</button></div>{error&&<div className="text-xs text-red-500 mt-2">{error}</div>}</div></div>
        </>}</>}
    </section>

    {detail&&<aside className="w-[270px] shrink-0 border-l border-neutral-200 dark:border-neutral-800 min-h-0 overflow-y-auto hidden xl:block"><div className="p-3 border-b border-neutral-200 dark:border-neutral-800"><div className="text-[10px] uppercase tracking-[.12em] opacity-45 mb-2 flex items-center gap-1.5"><Icon name="users" size={13}/>Humans</div><div className="space-y-2">{detail.members.map(m=><div key={m.userId} className="flex items-center gap-2"><Avatar src={m.userId===meUserId?meAvatarUrl:""} name={m.name} size={30}/><div className="min-w-0"><div className="text-xs font-medium truncate">{m.name}</div><div className="text-[9px] opacity-45 capitalize">{m.role}</div></div></div>)}</div>{["owner","admin"].includes(detail.room.role||"")&&<div className="mt-3 flex gap-1"><input value={inviteName} onChange={(e)=>setInviteName(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&void doInvite()} placeholder="Add by username" className="min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1.5 text-xs"/><button disabled={inviteBusy||!inviteName.trim()} onClick={()=>void doInvite()} className="h-8 w-8 grid place-items-center rounded-lg border disabled:opacity-40"><Icon name="plus" size={13}/></button></div>}</div>
      <div className="p-3"><div className="flex items-center justify-between mb-2"><div className="text-[10px] uppercase tracking-[.12em] opacity-45 flex items-center gap-1.5"><Icon name="bot" size={13}/>AI personas</div><button onClick={openPersonaDrawer} className="text-[10px] text-violet-500">+ Add</button></div>{detail.personas.length?detail.personas.map(p=><div key={p.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-2 mb-2"><div className="flex items-center gap-2"><Avatar src={p.avatarUrl||p.avatarPath} name={p.name} size={34}/><div className="min-w-0 flex-1"><div className="text-xs font-medium truncate">{p.name}</div><div className="text-[9px] opacity-45 truncate">{p.specialty}</div></div><button onClick={()=>void removePersona(p)} className="h-7 w-7 grid place-items-center rounded-lg opacity-45 hover:opacity-100 hover:text-red-500" title="Remove from room">×</button></div><select value={p.participationMode} onChange={(e)=>void changeMode(p,e.target.value as RoomPersona["participationMode"])} className="mt-2 w-full rounded-lg border bg-transparent px-2 py-1 text-[10px]"><option value="active">Active</option><option value="listening">Listening</option><option value="mention_only">Mention only</option><option value="muted">Muted</option></select></div>):<button onClick={openPersonaDrawer} className="w-full rounded-xl border border-dashed p-4 text-xs opacity-55 hover:opacity-100">Open the Persona drawer to add your AI band.</button>}
      {detail.room.role==="owner"&&<div className="mt-5 pt-4 border-t border-neutral-200 dark:border-neutral-800 space-y-2"><button onClick={async()=>{const next=detail.room.visibility==="public"?"private":"public";await updateRoom(detail.room.id,{visibility:next});await refreshDetail();await refreshRooms(detail.room.id);}} className="w-full rounded-lg border px-2 py-1.5 text-xs text-left">Make room {detail.room.visibility==="public"?"private":"public"}</button><button onClick={async()=>{if(confirm("Delete this room and its messages?")){await deleteRoom(detail.room.id);setActiveRoomId("");setDetail(null);await refreshRooms();}}} className="w-full rounded-lg border border-red-500/30 text-red-500 px-2 py-1.5 text-xs flex items-center gap-2"><Icon name="trash" size={13}/>Delete room</button></div>}
      {detail.room.role!=="owner"&&detail.room.joined&&<button onClick={async()=>{await leaveRoom(detail.room.id);setActiveRoomId("");setDetail(null);await refreshRooms();}} className="mt-5 w-full rounded-lg border px-2 py-1.5 text-xs">Leave room</button>}</div></aside>}
    {createOpen&&<RoomCreateModal onClose={()=>setCreateOpen(false)} onCreated={(r)=>{setCreateOpen(false);setRooms(prev=>[r,...prev]);setActiveRoomId(r.id);}}/>}
  </div>;
}
