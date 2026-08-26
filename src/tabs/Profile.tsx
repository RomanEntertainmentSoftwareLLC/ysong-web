import { useEffect, useRef, useState, type DragEvent } from "react";
import Avatar from "../components/Avatar";
import { YSButton } from "../components/YSButton";
import { apiGet, apiPost } from "../lib/authApi";
import { signedProfileAssetUrl, uploadProfileAsset } from "../lib/profileApi";

const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type MeResponse = {
  ok: boolean;
  user: {
    displayName?: string;
    gender?: string;
    country?: string;
    region?: string;
    city?: string;
    avatarObjectKey?: string;
  };
};

export default function ProfilePane() {
  const [displayName, setDisplayName] = useState("");
  const [gender, setGender] = useState("prefer_not_to_say");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [avatarObjectKey, setAvatarObjectKey] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiGet<MeResponse>("/auth/me")
      .then(async (data) => {
        const u = data.user || {};
        setDisplayName(String(u.displayName || ""));
        setGender(String(u.gender || "prefer_not_to_say"));
        setCountry(String(u.country || ""));
        setRegion(String(u.region || ""));
        setCity(String(u.city || ""));
        setAvatarObjectKey(String(u.avatarObjectKey || ""));
        if (u.avatarObjectKey) setAvatarUrl(await signedProfileAssetUrl(u.avatarObjectKey).catch(() => ""));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!avatarFile) return;
    const url = URL.createObjectURL(avatarFile);
    setAvatarUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const chooseFile = (file?: File | null) => {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setMessage("Use a PNG, JPG, or WebP image.");
      return;
    }
    setAvatarFile(file);
    setMessage("");
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const save = async () => {
    const clean = displayName.trim().replace(/\s+/g, " ");
    if (!clean) return setMessage("Choose a username / display name first.");
    setBusy(true);
    setMessage("");
    try {
      let nextAvatarKey = avatarObjectKey;
      if (avatarFile) {
        const uploaded = await uploadProfileAsset(avatarFile);
        nextAvatarKey = uploaded.objectKey;
      }
      const result = await apiPost<{ ok: true; displayName: string }>("/api/profile", {
        displayName: clean,
        gender,
        country,
        region,
        city,
        avatarObjectKey: nextAvatarKey,
      });
      setDisplayName(result.displayName);
      setAvatarObjectKey(nextAvatarKey);
      setAvatarFile(null);
      setMessage("Profile saved.");
      window.dispatchEvent(new Event("ysong:profile-changed"));
    } catch (error: any) {
      setMessage(error?.message === "username_taken" ? "That name is already in use." : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const removeAvatar = () => {
    setAvatarFile(null);
    setAvatarObjectKey("");
    setAvatarUrl("");
    setMessage("Avatar will be removed when you save.");
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-950 text-neutral-100">
      <div className="max-w-4xl mx-auto p-5 md:p-7 lg:p-9 pb-20">
        <header className="mb-6">
          <div className="text-xs uppercase tracking-[.22em] text-indigo-300">Your YSong identity</div>
          <h1 className="text-3xl font-semibold mt-1">Profile</h1>
          <p className="text-sm text-neutral-400 mt-2">Manage the identity people see across YSong and the private demographic fields used only for aggregate audience analytics.</p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5 md:p-6">
          <div className="grid md:grid-cols-[190px_minmax(0,1fr)] gap-7">
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragging(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
                onDrop={onDrop}
                className={`relative rounded-full p-1 transition ring-offset-4 ring-offset-neutral-950 ${dragging ? "ring-2 ring-indigo-400 bg-indigo-500/10 scale-[1.02]" : "hover:ring-2 hover:ring-white/20"}`}
                title="Click or drop an image to change your avatar"
              >
                <Avatar src={avatarUrl} name={displayName || "User"} size={148} />
                <span className={`absolute inset-1 rounded-full grid place-items-center text-xs font-medium bg-black/60 transition-opacity ${dragging ? "opacity-100" : "opacity-0 hover:opacity-100"}`}>{dragging ? "Drop image" : "Change avatar"}</span>
              </button>
              <input ref={fileRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { chooseFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              <YSButton type="button" onClick={() => fileRef.current?.click()} className="rounded-xl border border-white/15 px-3 py-2 text-xs hover:bg-white/5">Upload avatar</YSButton>
              {avatarUrl && <button type="button" className="text-xs text-red-300 hover:text-red-200" onClick={removeAvatar}>Remove avatar</button>}
              <div className="text-[11px] leading-relaxed text-neutral-500 text-center">Drag & drop, click the avatar, or use Upload avatar. No image uses the neutral silhouette.</div>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium">Username / display name<input value={displayName} maxLength={80} onChange={(e) => { setDisplayName(e.target.value); setMessage(""); }} className="profile-input" /></label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-sm font-medium">Gender<select value={gender} onChange={(e) => setGender(e.target.value)} className="profile-input"><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Non-binary</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></label>
                <label className="block text-sm font-medium">Country<input value={country} onChange={(e) => setCountry(e.target.value)} className="profile-input" /></label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-sm font-medium">State / region<input value={region} onChange={(e) => setRegion(e.target.value)} className="profile-input" /></label>
                <label className="block text-sm font-medium">City<input value={city} onChange={(e) => setCity(e.target.value)} className="profile-input" /></label>
              </div>
              <p className="text-xs text-neutral-500">Gender and location are used only for aggregate audience analytics. Your email stays private and creators do not see an individual listener's demographic profile.</p>
              {message && <div className="text-sm text-indigo-200">{message}</div>}
              <YSButton disabled={busy || !displayName.trim()} onClick={() => void save()} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 disabled:opacity-40">{busy ? "Saving…" : "Save profile"}</YSButton>
            </div>
          </div>
        </section>
      </div>
      <style>{`.profile-input{display:block;width:100%;margin-top:.4rem;border:1px solid rgb(64 64 64);background:rgb(10 10 10);border-radius:.75rem;padding:.65rem .75rem;outline:none;color:#f5f5f5}.profile-input:focus{border-color:rgb(129 140 248);box-shadow:0 0 0 2px rgb(99 102 241 / .14)}`}</style>
    </div>
  );
}
