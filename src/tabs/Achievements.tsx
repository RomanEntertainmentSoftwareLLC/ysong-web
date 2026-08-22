import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/authApi";

type Achievement = {
	key: string;
	category: string;
	icon: string;
	title: string;
	description: string;
	metric: string;
	target: number;
	points: number;
	progress: number;
	rawProgress: number;
	unlocked: boolean;
	unlockedAt: string | null;
};

type Payload = { achievements: Achievement[]; points: number; unlockedCount: number; totalCount: number; stats: Record<string, number> };

export default function AchievementsPane() {
	const [data, setData] = useState<Payload | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [category, setCategory] = useState("All");

	const load = async () => {
		setLoading(true); setError("");
		try { setData(await apiGet<Payload>("/api/achievements")); }
		catch (e: any) { setError(e?.message || "Could not load achievements"); }
		finally { setLoading(false); }
	};
	useEffect(() => { load(); }, []);
	useEffect(() => {
		const fn = () => load();
		window.addEventListener("ysong:achievements-changed", fn);
		return () => window.removeEventListener("ysong:achievements-changed", fn);
	}, []);

	const categories = useMemo(() => ["All", ...Array.from(new Set(data?.achievements.map((a) => a.category) || []))], [data]);
	const visible = useMemo(() => (data?.achievements || []).filter((a) => category === "All" || a.category === category), [data, category]);

	return <div className="h-full min-h-0 overflow-y-auto bg-neutral-950 text-neutral-100">
		<div className="p-4 md:p-6 pb-28 max-w-6xl mx-auto">
			<div className="rounded-3xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/15 via-neutral-950 to-fuchsia-500/10 p-5 md:p-7 mb-6 overflow-hidden relative">
				<div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo-500/10 blur-3xl" />
				<div className="relative flex flex-col md:flex-row md:items-end justify-between gap-5">
					<div><div className="text-xs uppercase tracking-[.24em] text-indigo-300">YSong Achievements</div><h1 className="text-3xl md:text-4xl font-bold mt-1">Make it. Find it. Earn it.</h1><p className="text-neutral-400 mt-2 max-w-2xl">Achievements reward creating, publishing, discovering and supporting music. Points are prestige only — no pay-to-win nonsense.</p></div>
					<div className="grid grid-cols-3 gap-2 min-w-[280px]">
						<Stat value={data?.points ?? 0} label="Points" />
						<Stat value={data?.unlockedCount ?? 0} label="Unlocked" />
						<Stat value={data?.totalCount ?? 0} label="Total" />
					</div>
				</div>
			</div>

			<div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 px-4 py-3 mb-6 text-sm text-neutral-300">
				<span className="font-semibold text-cyan-200">Listening & Fandom:</span> qualified listening-time achievements and artist-percentile badges are planned for the listening analytics pass, so hours cannot be gamed by simply leaving a player open.
			</div>

			<div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-5">
				{categories.map((c) => <button key={c} onClick={() => setCategory(c)} className={`shrink-0 rounded-full px-4 py-2 text-sm border ${category === c ? "bg-white text-black border-white" : "border-neutral-700 hover:bg-neutral-900"}`}>{c}</button>)}
			</div>

			{error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200 text-sm">{error}</div>}
			{loading ? <div className="text-neutral-400">Loading achievements…</div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{visible.map((a) => <AchievementCard key={a.key} achievement={a} />)}
			</div>}
		</div>
	</div>;
}

function Stat({ value, label }: { value: number; label: string }) {
	return <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-center"><div className="text-xl md:text-2xl font-bold">{value.toLocaleString()}</div><div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div></div>;
}

function AchievementCard({ achievement: a }: { achievement: Achievement }) {
	const pct = Math.min(100, a.target ? (a.progress / a.target) * 100 : 0);
	return <div className={`relative overflow-hidden rounded-2xl border p-4 transition ${a.unlocked ? "border-amber-300/30 bg-gradient-to-br from-amber-400/10 via-neutral-900 to-indigo-500/5" : "border-neutral-800 bg-neutral-900/55"}`}>
		{a.unlocked && <div className="absolute right-3 top-3 text-[10px] uppercase tracking-[.2em] text-amber-300">Unlocked</div>}
		<div className="flex gap-4">
			<div className={`h-14 w-14 shrink-0 rounded-2xl grid place-items-center text-2xl border ${a.unlocked ? "bg-amber-300/10 border-amber-300/25 shadow-[0_0_28px_rgba(251,191,36,.09)]" : "bg-neutral-950 border-neutral-800 grayscale opacity-55"}`}>{a.unlocked ? a.icon : "🔒"}</div>
			<div className="min-w-0 flex-1 pr-12"><div className="font-semibold">{a.title}</div><div className="text-sm text-neutral-400 mt-0.5">{a.description}</div><div className="mt-3 h-1.5 rounded-full bg-neutral-800 overflow-hidden"><div className={`h-full rounded-full ${a.unlocked ? "bg-amber-300" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} /></div><div className="flex justify-between text-[11px] text-neutral-500 mt-1.5"><span>{Math.min(a.rawProgress, a.target).toLocaleString()} / {a.target.toLocaleString()}</span><span>+{a.points} pts</span></div>{a.unlockedAt && <div className="text-[10px] text-neutral-600 mt-1">Unlocked {new Date(a.unlockedAt).toLocaleDateString()}</div>}</div>
		</div>
	</div>;
}
