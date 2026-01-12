import { useState } from "react";
import Reveal from "./Reveal";
import { useTheme } from "../ThemeContext";
import { useNavigate } from "react-router-dom";
import ysongTitleWithLogo from "/ysong-logo-with-title.png";
import ysongTitleWithLogoDark from "/ysong-logo-with-title-darkmode.png";
import { YSButton } from "./YSButton";

export default function Home() {
	const { dark } = useTheme();
	const navigate = useNavigate();

	// ---- Feature data (trim/add as you like) ----
	const SECTIONS: {
		title: "Create" | "Transform" | "Generate" | "Learn";
		items: string[];
	}[] = [
		{
			title: "Create",
			items: [
				"Built-in DAW: record, edit, comp, mix",
				"Record any instrument via audio/MIDI interface",
				"Import stems, MIDI, external tracks",
				"Cloud Sync with version history & snapshots",
				"Plugin Hub — use YSong inside other DAWs (VST/AU)",
				"Macro Automator — record & replay workflows",
				"Moodboard Studio — visual references for your project",
				"Project sharing, collaboration links, and roles",
				"Royalty Split Tracker — manage splits & rights",
				"Export MP3, WAV, FLAC, and MIDI",
				"Cross-platform desktop, mobile, and web",
				"Offline mode for traveling musicians",
				"API access for developers",
				"Secure Cloud Storage — encrypted backups",
			],
		},
		{
			title: "Transform",
			items: [
				"Time-stretch, pitch-shift, remix, and remaster",
				"Swap genres dynamically (e.g., pop → synthwave)",
				"Mood-to-Mix Engine — mix/master by emotion",
				"Swap singers (your voice or modeled timbres)",
				"Translate lyrics or swap languages in songs",
				"Split to a cappella & instrumental",
				"Isolate individual instruments (drums, bass, etc.)",
				"Generate MIDI from audio",
				"Noise cleanup — crackle, hum, crowd, bass fixes",
				"Mastering assistant with reference matching",
				"Arrangement re-map — re-order sections instantly",
				"Stem-to-score — produce notation from stems",
				"Plagiarism Detector & Audio Fingerprinting",
			],
		},
		{
			title: "Generate",
			items: [
				"Generate full songs from text prompts",
				"Lyric generator from prompts or mood",
				"Extract lyrics from audio",
				"Generate melodies, chords, & full arrangements",
				"Writers Block Mode — next notes/lines suggestions",
				"Voice-to-MIDI — hum or sing to create melodies",
				"Real-time Lyric-to-Melody generator",
				"AI Session Players — drummer, bassist, guitarist",
				"AI Producer Mode — mix/master guidance",
				"AI DJ/Curator — playlists & auto-mixing",
				"Album covers, artwork, spines (up to 4K)",
				"Band name art & logos",
				"Muse Engine — ethical style embeddings (rhythm, harmony, timbre, structure)",
				"Reference blend: weight 1–5 influence tracks",
				"Structure archetypes & energy curves",
				"Timbre profiles for amps, drums, vocals, rooms",
				"Lyric motif modeling (no line lifting)",
				"Originality guardrails + live Originality Score",
				"“Make more unique” one-click rewrites",
				"Personal Style Capture → save/share Style Packs",
				"Live adaptation as you edit tempo/arrangement",
				"Emotion-reactive visuals & music-video drafts",
			],
		},
		{
			title: "Learn",
			items: [
				"Interactive lessons (beginner → advanced) for every instrument",
				"Teach music theory: harmony, rhythm, form",
				"Adaptive curriculum that adjusts to your progress",
				"Ear-Training AI Coach",
				"Song Breakdown Mode — how famous tracks were built",
				"Produce sheet music by instrument",
				"Generate guitar tabs",
				"Music Atlas — styles by decade & region",
				"Discography Explorer — artist timelines",
				"Global Influence Map — how genres cross-pollinate",
				"Historical Recording Restoration for study",
				"Music Copilot — in-context tips while you work",
				"Talent Matchmaking & Live Feedback Sessions",
				"AI critiques & mentor personas (virtual producers)",
				"Creative Stats Dashboard & achievements",
			],
		},
	];

	const Card = ({ title, items, defaultCount = 8 }: { title: string; items: string[]; defaultCount?: number }) => {
		const [open, setOpen] = useState(false);

		const isExpandable = items.length > defaultCount;
		const shown = !isExpandable || open ? items : items.slice(0, defaultCount);
		const remaining = isExpandable ? items.length - defaultCount : 0;

		return (
			<Reveal className="rounded-xl border p-4">
				<div className="flex items-center justify-between gap-3">
					<h4 className="font-semibold">{title}</h4>
					<span className="text-xs opacity-70">{items.length} features</span>
				</div>

				<ul className="mt-2 list-disc pl-5 text-sm leading-6 space-y-1.5">
					{shown.map((t, i) => (
						<li key={i}>{t}</li>
					))}
				</ul>

				{isExpandable && (
					<YSButton
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="mt-3 text-xs px-2 py-1 rounded-md border hover:bg-neutral-100 dark:hover:bg-neutral-800"
					>
						{open ? "Show less" : `Show ${remaining} more`}
					</YSButton>
				)}
			</Reveal>
		);
	};

	return (
		<div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
			{/* LOGO */}
			<section className="pt-1 sm:pt-1">
				<Reveal className="text-center space-y-2 sm:space-y-3g">
					<img
						src={dark ? ysongTitleWithLogoDark : ysongTitleWithLogo}
						alt={import.meta.env.VITE_APP_NAME}
						className="mx-auto h-16 sm:h-20 md:h-28 lg:h-32 w-auto"
						loading="eager"
					/>
					<h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
						Your ultimate AI music studio and co-pilot
					</h1>
					<p className="mt-3 text-sm sm:text-base">
						Create, transform, generate, and learn music all on one platform powered by
						<span className="whitespace-nowrap"> advanced artificial intelligence</span> that understands
						music the way you do!
					</p>
				</Reveal>

				{/* Image / banner */}
				<Reveal className="mt-6">
					<div className="relative w-full h-56 sm:h-72 md:h-120 rounded-2xl overflow-hidden">
						<img
							src="/homestudio.png"
							alt="Producer smiling in a neon-lit home studio"
							className="absolute inset-0 w-full h-full object-cover"
							loading="eager"
							decoding="async"
						/>
					</div>
				</Reveal>
			</section>

			{/* WHAT IS YSONG */}
			<section className="mt-6 sm:mt-8">
				<Reveal as="h2" className="text-2xl sm:text-3xl font-bold">
					What is {import.meta.env.VITE_APP_NAME}?
				</Reveal>
				<Reveal as="p" className="mt-3">
					<strong>{import.meta.env.VITE_APP_NAME}</strong> is an end-to-end AI music studio, co-pilot, and
					instructor. Create, transform, generate, and analyze music from first idea to finished release while
					working with the tools you already use. With a vast library spanning from Bach to Beyoncé,{" "}
					{import.meta.env.VITE_APP_NAME} surfaces artist histories and discographies and guides you with
					interactive lessons to level up your skills on any instrument. Available on desktop, mobile, and the
					web.
				</Reveal>
			</section>

			{/* FEATURE GRID (Create / Transform / Generate / Learn) */}
			<section className="mt-10 sm:mt-12">
				<Reveal as="h3" className="text-xl sm:text-2xl font-semibold">
					What you can do with {import.meta.env.VITE_APP_NAME}
				</Reveal>

				<div className="mt-6 grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-2">
					{SECTIONS.map((s) => (
						<Card key={s.title} title={s.title} items={s.items} />
					))}
				</div>
			</section>

			{/* PLATFORMS */}
			<section className="mt-10 sm:mt-12">
				<Reveal as="h3" className="text-xl sm:text-2xl font-semibold">
					Platforms
				</Reveal>
				<Reveal className="mt-4 flex flex-wrap gap-2">
					{["Windows", "macOS", "Linux", "iOS", "Android", "Web", "VST3 plug-in"].map((p) => (
						<span
							key={p}
							className="rounded-full border border-neutral-300/70 dark:border-neutral-700/70 px-3 py-1 text-xs sm:text-sm"
						>
							{p}
						</span>
					))}
				</Reveal>
			</section>

			{/* CTA */}
			<section className="mt-10 sm:mt-12 mb-16 text-center">
				<Reveal>
					<YSButton
						type="button"
						onClick={() => navigate("/signup")}
						className="px-3 py-2 text-sm font-medium rounded-lg border"
					>
						Get started
					</YSButton>
				</Reveal>
			</section>
		</div>
	);
}
