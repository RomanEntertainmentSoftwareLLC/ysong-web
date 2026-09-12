import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
	fetchGenreAtlasScanStatus,
	fetchGenreAtlasStats,
	fetchGenreCatalog,
	fetchGenreRadar,
	startGenreAtlasScan,
} from "../../api/musicIntelClient";
import type {
	GenreAtlasScanJob,
	GenreAtlasStats,
	GenreCatalogEntry,
	GenreCatalogResponse,
	GenreRadarEntry,
	GenreRadarLeaderboard,
	GenreRadarReport,
} from "../../types/musicIntel";
import { formatGeneratedAt } from "../dashboardUtils";
import { useDashboardWorkspace } from "../DashboardWorkspaceContext";

const GENRE_RADAR_REPORT_KEY = "ysong.tools.seo.genre-radar-report";
const GENRE_RADAR_UNIVERSE_KEY = "ysong.tools.seo.genre-radar-universe";
const GENRE_RADAR_TOP_COUNT_KEY = "ysong.tools.seo.genre-radar-top-count";
const GENRE_ATLAS_JOB_ID_KEY = "ysong.tools.seo.genre-atlas-job-id";
const GENRE_RADAR_WATCHLIST_KEY = "ysong.tools.seo.genre-radar-watchlist";
const GENRE_RADAR_HISTORY_KEY = "ysong.tools.seo.genre-radar-history";

type TopCount = 10 | 20;
type QuickUniverse = "starter" | "expanded";
type RadarHistoryEntry = {
	generatedAt: string;
	universeLabel: string;
	topHeat: string;
	dailyTarget: string;
	opportunityGap: number;
	providerSummary: string;
};

const MODIFIER_PRESETS = [
	"AI",
	"Anime",
	"Workout",
	"Gaming",
	"Sleep",
	"Dark",
	"Epic",
	"Instrumental",
	"Female Vocal",
	"Cyber",
];

function safeReadStorageValue<T>(key: string, fallback: T): T {
	try {
		const rawValue = window.localStorage.getItem(key);
		if (!rawValue) {
			return fallback;
		}

		return JSON.parse(rawValue) as T;
	} catch {
		return fallback;
	}
}

function safeReadReport(): GenreRadarReport | null {
	const parsedValue = safeReadStorageValue<unknown>(GENRE_RADAR_REPORT_KEY, null);
	if (!parsedValue || typeof parsedValue !== "object") {
		return null;
	}

	return parsedValue as GenreRadarReport;
}

function safeReadUniverse(): QuickUniverse {
	const parsedValue = safeReadStorageValue<unknown>(GENRE_RADAR_UNIVERSE_KEY, "starter");
	return parsedValue === "expanded" ? "expanded" : "starter";
}

function safeReadTopCount(): TopCount {
	const parsedValue = safeReadStorageValue<unknown>(GENRE_RADAR_TOP_COUNT_KEY, 20);
	return parsedValue === 10 ? 10 : 20;
}

function safeReadWatchlist(): GenreRadarEntry[] {
	const parsedValue = safeReadStorageValue<unknown>(GENRE_RADAR_WATCHLIST_KEY, []);
	if (!Array.isArray(parsedValue)) {
		return [];
	}

	return parsedValue.filter((entry): entry is GenreRadarEntry => Boolean(entry && typeof entry === "object" && "genre" in entry));
}

function safeReadHistory(): RadarHistoryEntry[] {
	const parsedValue = safeReadStorageValue<unknown>(GENRE_RADAR_HISTORY_KEY, []);
	if (!Array.isArray(parsedValue)) {
		return [];
	}

	return parsedValue.filter((entry): entry is RadarHistoryEntry => {
		return Boolean(entry && typeof entry === "object" && "generatedAt" in entry && "dailyTarget" in entry);
	});
}

function makeHistoryEntry(report: GenreRadarReport): RadarHistoryEntry {
	const topHeat = report.leaderboards.marketHeat.entries[0]?.genre || "—";
	const target = report.insights?.dailyTarget;
	return {
		generatedAt: report.generatedAt,
		universeLabel: report.universe.label,
		topHeat,
		dailyTarget: target?.genre || "—",
		opportunityGap: target?.opportunityGap || 0,
		providerSummary: report.providerSummary,
	};
}

function safeReadAtlasJobId(): string | null {
	const parsedValue = safeReadStorageValue<unknown>(GENRE_ATLAS_JOB_ID_KEY, null);
	return typeof parsedValue === "string" && parsedValue.trim() ? parsedValue : null;
}

function writeStorageValue(key: string, value: unknown): void {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Browser storage is convenience, not a hard dependency.
	}
}

function removeStorageValue(key: string): void {
	try {
		window.localStorage.removeItem(key);
	} catch {
		// Browser storage is convenience, not a hard dependency.
	}
}

function scoreTone(score: number): string {
	if (score >= 80) {
		return "radar-score-strong";
	}

	if (score >= 65) {
		return "radar-score-promising";
	}

	if (score >= 50) {
		return "radar-score-watch";
	}

	return "radar-score-muted";
}

function getLeaderboardScore(entry: GenreRadarEntry, metric: GenreRadarLeaderboard["metric"]): number {
	if (metric === "marketHeat") return entry.marketHeat;
	if (metric === "opportunityGap") return entry.opportunityGap;
	return entry.opportunity;
}

function getSupplyPressureLabel(supply: number): string {
	if (supply >= 82) return "Heavy supply";
	if (supply >= 62) return "Moderate supply";
	return "Thin supply";
}

function makeSongBrief(entry: GenreRadarEntry): string {
	const targetMood = entry.category.includes("Electronic")
		? "dark club energy, strong hook, clean repeatable drop"
		: entry.category.includes("Metal")
			? "cinematic intro, huge chorus, aggressive but memorable riff"
			: entry.category.includes("Functional")
				? "loopable, useful, low-friction listening, strong retention"
				: "clear identity, strong chorus, platform-friendly metadata";

	return [
		`Genre target: ${entry.genre}`,
		`Category: ${entry.category}`,
		`Why now: demand ${entry.demand}/100, momentum ${entry.momentum}/100, visible supply ${entry.supply}/100, opportunity gap ${entry.opportunityGap}/100.`,
		`Production angle: ${targetMood}.`,
		`Metadata angle: lead with "${entry.genre}", then test adjacent language from Keyword Intel after probing it.`,
		`Suggested action: create 1 strong track and 1 alternate mix, then compare title/thumbnail/metadata variants rather than guessing blindly.`,
	].join("\n");
}

function MiniBar({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "supply" | "gap" }) {
	return (
		<div className={`radar-mini-bar radar-mini-bar-${tone}`}>
			<div className="radar-mini-bar-label">
				<span>{label}</span>
				<b>{value}</b>
			</div>
			<div className="radar-mini-bar-track" aria-hidden="true">
				<span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
			</div>
		</div>
	);
}

function LeaderboardPanel({
	leaderboard,
	isBusy,
	onProbe,
	onSave,
	onBrief,
}: {
	leaderboard: GenreRadarLeaderboard;
	isBusy: boolean;
	onProbe: (genre: string) => Promise<void>;
	onSave: (entry: GenreRadarEntry) => void;
	onBrief: (entry: GenreRadarEntry) => void;
}) {
	return (
		<article className="dashboard-panel radar-leaderboard-panel">
			<div className="dashboard-panel-heading compact">
				<div>
					<span className="dashboard-micro-label">Live genre ranking</span>
					<h2>{leaderboard.label}</h2>
				</div>
			</div>
			<p className="panel-note">{leaderboard.description}</p>

			<div className="radar-leaderboard-list">
				{leaderboard.entries.map((entry, index) => {
					const displayScore = getLeaderboardScore(entry, leaderboard.metric);
					return (
						<div className="radar-leaderboard-row" key={`${leaderboard.metric}-${entry.genre}`}>
							<span className="radar-rank">#{index + 1}</span>
							<div className="radar-entry-copy">
								<strong>{entry.genre}</strong>
								<small>
									{entry.category} · {entry.providerSummary}
								</small>
							</div>
							<div className="radar-score-cluster">
								<b className={`radar-primary-score ${scoreTone(displayScore)}`}>{displayScore}</b>
								<div className="radar-mini-metrics">
									<span>D {entry.demand}</span>
									<span>S {entry.supply}</span>
									<span>G {entry.opportunityGap}</span>
								</div>
								<div className="radar-supply-demand-bars">
									<MiniBar label="Demand" value={entry.demand} />
									<MiniBar label="Supply" tone="supply" value={entry.supply} />
								</div>
							</div>
							<div className="radar-row-actions">
								<button disabled={isBusy} onClick={() => void onProbe(entry.genre)} type="button">Probe</button>
								<button disabled={isBusy} onClick={() => onSave(entry)} type="button">Save</button>
								<button disabled={isBusy} onClick={() => onBrief(entry)} type="button">Brief</button>
							</div>
						</div>
					);
				})}
			</div>
		</article>
	);
}

function AtlasProgressPanel({ job }: { job: GenreAtlasScanJob }) {
	return (
		<section className={`dashboard-panel atlas-progress-panel atlas-state-${job.state}`}>
			<div className="dashboard-panel-heading compact">
				<div>
					<span className="dashboard-micro-label">Full atlas sweep</span>
					<h2>{job.stageLabel}</h2>
				</div>
			</div>

			<div className="atlas-progress-grid">
				<div className="atlas-progress-copy">
					<strong>{job.progress.percent}%</strong>
					<span>
						{job.progress.completed.toLocaleString("en-US")} / {job.progress.total.toLocaleString("en-US")} terms processed
					</span>
					<small>
						{job.progress.currentGenre ? `Current term: ${job.progress.currentGenre}` : "Waiting for the YSong atlas worker."}
					</small>
				</div>
				<div className="atlas-progress-track" aria-hidden="true">
					<span style={{ width: `${job.progress.percent}%` }} />
				</div>
			</div>

			{job.error ? <p className="analysis-error">{job.error}</p> : null}
		</section>
	);
}

function CatalogResultRow({
	entry,
	isBusy,
	onProbe,
}: {
	entry: GenreCatalogEntry;
	isBusy: boolean;
	onProbe: (genre: string) => Promise<void>;
}) {
	return (
		<div className="atlas-catalog-row">
			<div>
				<strong>{entry.genre}</strong>
				<small>
					{entry.category} · {entry.source}
				</small>
			</div>
			<button disabled={isBusy} onClick={() => void onProbe(entry.genre)} type="button">
				Probe
			</button>
		</div>
	);
}


function DailyTargetPanel({ entry, onProbe, onSave, onBrief }: { entry: (GenreRadarEntry & { targetScore?: number }) | null; onProbe: (genre: string) => Promise<void>; onSave: (entry: GenreRadarEntry) => void; onBrief: (entry: GenreRadarEntry) => void }) {
	if (!entry) {
		return null;
	}

	return (
		<section className="dashboard-panel daily-target-panel">
			<div>
				<span className="dashboard-micro-label">Daily Genre Target</span>
				<h2>{entry.genre}</h2>
				<p>
					The best practical target in this scan: demand is strong, momentum is alive, and supply pressure is not as suffocating as the pure heat leaders.
				</p>
				<div className="daily-target-actions">
					<button onClick={() => void onProbe(entry.genre)} type="button">Probe target</button>
					<button onClick={() => onBrief(entry)} type="button">Create song brief</button>
					<button onClick={() => onSave(entry)} type="button">Save target</button>
				</div>
			</div>
			<div className="daily-target-score-card">
				<strong>{entry.opportunityGap}</strong>
				<span>Opportunity Gap</span>
				<MiniBar label="Demand" value={entry.demand} />
				<MiniBar label="Supply" tone="supply" value={entry.supply} />
				<MiniBar label="Momentum" tone="gap" value={entry.momentum} />
				<small>{getSupplyPressureLabel(entry.supply)} · {entry.providerSummary}</small>
			</div>
		</section>
	);
}

function InsightCard({ title, label, entry }: { title: string; label: string; entry: GenreRadarEntry | null }) {
	return (
		<article className="dashboard-panel radar-insight-card">
			<span className="dashboard-micro-label">{label}</span>
			<h2>{entry?.genre || "—"}</h2>
			<p>{entry ? title : "Run a scan to populate this recommendation."}</p>
			{entry ? (
				<div className="radar-insight-metrics">
					<span>D {entry.demand}</span>
					<span>S {entry.supply}</span>
					<span>Gap {entry.opportunityGap}</span>
				</div>
			) : null}
		</article>
	);
}

function LowHangingFruitPanel({ entries, onProbe, onBrief }: { entries: GenreRadarEntry[]; onProbe: (genre: string) => Promise<void>; onBrief: (entry: GenreRadarEntry) => void }) {
	if (entries.length === 0) {
		return null;
	}

	return (
		<section className="dashboard-panel low-fruit-panel">
			<div className="dashboard-panel-heading compact">
				<div>
					<span className="dashboard-micro-label">Low-Hanging Fruit</span>
					<h2>Good demand without the worst supply crush.</h2>
				</div>
			</div>
			<div className="low-fruit-list">
				{entries.map((entry, index) => (
					<div className="low-fruit-row" key={`fruit-${entry.genre}`}>
						<span>#{index + 1}</span>
						<div>
							<strong>{entry.genre}</strong>
							<small>D {entry.demand} · S {entry.supply} · Gap {entry.opportunityGap}</small>
						</div>
						<button onClick={() => void onProbe(entry.genre)} type="button">Probe</button>
						<button onClick={() => onBrief(entry)} type="button">Brief</button>
					</div>
				))}
			</div>
		</section>
	);
}

function TrendHistoryPanel({ history }: { history: RadarHistoryEntry[] }) {
	return (
		<section className="dashboard-panel trend-history-panel">
			<div className="dashboard-panel-heading compact">
				<div>
					<span className="dashboard-micro-label">Trend History</span>
					<h2>Scan memory</h2>
				</div>
			</div>
			{history.length ? (
				<div className="trend-history-list">
					{history.slice(0, 6).map((entry) => (
						<div className="trend-history-row" key={entry.generatedAt}>
							<div>
								<strong>{entry.dailyTarget}</strong>
								<small>{entry.universeLabel} · {formatGeneratedAt(entry.generatedAt)} · Heat leader: {entry.topHeat}</small>
							</div>
							<span>Gap {entry.opportunityGap}</span>
						</div>
					))}
				</div>
			) : (
				<p>Run scans over multiple days and this will become the saved memory for rising/falling genre targets.</p>
			)}
		</section>
	);
}

function ModifierLabPanel({ entry, onProbe }: { entry: GenreRadarEntry | null; onProbe: (genre: string) => Promise<void> }) {
	if (!entry) {
		return null;
	}

	return (
		<section className="dashboard-panel modifier-lab-panel">
			<div className="dashboard-panel-heading compact">
				<div>
					<span className="dashboard-micro-label">Modifier Lab</span>
					<h2>Turn the target into sharper micro-niches.</h2>
				</div>
			</div>
			<p className="panel-note">The genre is only the first layer. These one-click probes test combinations like AI + genre, anime + genre, workout + genre, and dark/epic variants.</p>
			<div className="modifier-chip-grid">
				{MODIFIER_PRESETS.map((modifier) => {
					const query = `${modifier} ${entry.genre}`;
					return (
						<button key={query} onClick={() => void onProbe(query)} type="button">
							{query}
						</button>
					);
				})}
			</div>
		</section>
	);
}

function QualitySupplyPanel({ entry }: { entry: GenreRadarEntry | null }) {
	if (!entry) {
		return null;
	}
	const weakSupplySignal = Math.max(0, Math.min(100, Math.round((100 - entry.supply) * 0.55 + entry.demand * 0.25 + entry.momentum * 0.2)));
	const qualityRisk = Math.max(0, Math.min(100, Math.round(entry.supply * 0.6 + entry.competition * 0.25 - entry.momentum * 0.15)));
	return (
		<section className="dashboard-panel quality-supply-panel">
			<span className="dashboard-micro-label">Quality Supply Detector</span>
			<h2>Is the lane crowded with strong supply or just noisy?</h2>
			<p>This is still a proxy, but it starts separating raw result count from practical attackability.</p>
			<MiniBar label="Weak-supply opening" tone="gap" value={weakSupplySignal} />
			<MiniBar label="Crowded-quality risk" tone="supply" value={qualityRisk} />
			<small>{entry.genre}: demand {entry.demand}, momentum {entry.momentum}, visible supply {entry.supply}. Later this can use top-result age, channel dominance, and engagement quality.</small>
		</section>
	);
}
function GenreRadarPage() {
	const navigate = useNavigate();
	const { apiState, runAnalysis, isAnalyzing } = useDashboardWorkspace();
	const [universe, setUniverse] = useState<QuickUniverse>(() => safeReadUniverse());
	const [topCount, setTopCount] = useState<TopCount>(() => safeReadTopCount());
	const [report, setReport] = useState<GenreRadarReport | null>(() => safeReadReport());
	const [isScanning, setIsScanning] = useState(false);
	const [scanError, setScanError] = useState<string | null>(null);
	const [atlasStats, setAtlasStats] = useState<GenreAtlasStats | null>(null);
	const [atlasJob, setAtlasJob] = useState<GenreAtlasScanJob | null>(null);
	const [atlasJobId, setAtlasJobId] = useState<string | null>(() => safeReadAtlasJobId());
	const [atlasError, setAtlasError] = useState<string | null>(null);
	const [catalogQuery, setCatalogQuery] = useState("");
	const [catalogResponse, setCatalogResponse] = useState<GenreCatalogResponse | null>(null);
	const [watchlist, setWatchlist] = useState<GenreRadarEntry[]>(() => safeReadWatchlist());
	const [songBrief, setSongBrief] = useState<string>("");
	const [history, setHistory] = useState<RadarHistoryEntry[]>(() => safeReadHistory());
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [isCatalogLoading, setIsCatalogLoading] = useState(false);

	const canScan = apiState === "online" && !isScanning && atlasJob?.state !== "running";
	const scanLabel = universe === "starter" ? "Scan starter 40" : "Scan expanded 80";
	const atlasRunning = atlasJob?.state === "running";
	const canStartAtlas = apiState === "online" && !atlasRunning && !isScanning;

	const reportFreshness = useMemo(() => {
		if (!report) {
			return "No genre radar scan has been run yet.";
		}

		return `${report.cacheState === "cache-hit" ? "Served from YSong scan cache" : "Fresh scan"} · ${formatGeneratedAt(report.generatedAt)}`;
	}, [report]);

	useEffect(() => {
		writeStorageValue(GENRE_RADAR_WATCHLIST_KEY, watchlist);
	}, [watchlist]);

	useEffect(() => {
		writeStorageValue(GENRE_RADAR_HISTORY_KEY, history);
	}, [history]);

	useEffect(() => {
		if (apiState !== "online") {
			return;
		}

		let cancelled = false;
		fetchGenreAtlasStats()
			.then((stats) => {
				if (!cancelled) {
					setAtlasStats(stats);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setAtlasError(error instanceof Error ? error.message : "Could not load atlas stats.");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [apiState]);

	useEffect(() => {
		if (apiState !== "online") {
			return;
		}

		let cancelled = false;
		fetchGenreCatalog("", 20)
			.then((response) => {
				if (!cancelled) {
					setCatalogResponse(response);
					setCatalogError(null);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setCatalogError(error instanceof Error ? error.message : "Could not load the genre catalog preview.");
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsCatalogLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [apiState]);

	useEffect(() => {
		if (apiState !== "online" || !atlasJobId) {
			return;
		}

		let cancelled = false;
		fetchGenreAtlasScanStatus(atlasJobId)
			.then((job) => {
				if (cancelled) {
					return;
				}

				setAtlasJob(job);
				if (job.report) {
					rememberReport(job.report);
					writeStorageValue(GENRE_RADAR_REPORT_KEY, job.report);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setAtlasJobId(null);
					removeStorageValue(GENRE_ATLAS_JOB_ID_KEY);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [apiState, atlasJobId]);

	useEffect(() => {
		if (apiState !== "online" || !atlasJob || atlasJob.state !== "running") {
			return;
		}

		let cancelled = false;
		const intervalId = window.setInterval(() => {
			void fetchGenreAtlasScanStatus(atlasJob.id)
				.then((job) => {
					if (cancelled) {
						return;
					}

					setAtlasJob(job);
					if (job.report) {
						rememberReport(job.report);
						writeStorageValue(GENRE_RADAR_REPORT_KEY, job.report);
					}
				})
				.catch((error: unknown) => {
					if (!cancelled) {
						setAtlasError(error instanceof Error ? error.message : "Could not refresh atlas scan progress.");
					}
				});
		}, 1200);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [apiState, atlasJob]);

	function rememberReport(nextReport: GenreRadarReport): void {
		setReport(nextReport);
		setHistory((previous) => {
			if (previous.some((entry) => entry.generatedAt === nextReport.generatedAt)) {
				return previous;
			}
			return [makeHistoryEntry(nextReport), ...previous].slice(0, 12);
		});
	}

	async function runRadarScan(nextUniverse = universe, nextTopCount = topCount): Promise<void> {
		if (apiState !== "online" || isScanning) {
			return;
		}

		setIsScanning(true);
		setScanError(null);
		setUniverse(nextUniverse);
		setTopCount(nextTopCount);
		writeStorageValue(GENRE_RADAR_UNIVERSE_KEY, nextUniverse);
		writeStorageValue(GENRE_RADAR_TOP_COUNT_KEY, nextTopCount);

		try {
			const nextReport = await fetchGenreRadar(nextUniverse, nextTopCount);
			rememberReport(nextReport);
			writeStorageValue(GENRE_RADAR_REPORT_KEY, nextReport);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Genre Radar scan failed.";
			setScanError(message);
		} finally {
			setIsScanning(false);
		}
	}

	async function beginAtlasSweep(): Promise<void> {
		if (!canStartAtlas) {
			return;
		}

		setAtlasError(null);
		try {
			const job = await startGenreAtlasScan(topCount, 80);
			setAtlasJob(job);
			setAtlasJobId(job.id);
			writeStorageValue(GENRE_ATLAS_JOB_ID_KEY, job.id);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not start the full atlas sweep.";
			setAtlasError(message);
		}
	}

	async function runCatalogSearch(): Promise<void> {
		if (apiState !== "online" || isCatalogLoading) {
			return;
		}

		setIsCatalogLoading(true);
		setCatalogError(null);
		try {
			const response = await fetchGenreCatalog(catalogQuery, 30);
			setCatalogResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Genre catalog lookup failed.";
			setCatalogError(message);
		} finally {
			setIsCatalogLoading(false);
		}
	}

	async function probeGenre(genre: string): Promise<void> {
		const nextReport = await runAnalysis(genre);
		if (nextReport) {
			navigate("/dashboard/niche-intel");
		}
	}

	function saveTarget(entry: GenreRadarEntry): void {
		setWatchlist((previous) => {
			const deduped = previous.filter((item) => item.genre.toLowerCase() !== entry.genre.toLowerCase());
			return [entry, ...deduped].slice(0, 12);
		});
	}

	function createBrief(entry: GenreRadarEntry): void {
		setSongBrief(makeSongBrief(entry));
	}

	return (
		<>
			<header className="dashboard-topbar">
				<div>
					<span className="dashboard-kicker">Genre Radar</span>
					<h1>Top genres, now with a real dictionary-scale atlas path</h1>
				</div>

				<div className="dashboard-status-cluster">
					<div className={`dashboard-status-pill api-state-${apiState}`}>
						<span />
						{apiState === "online" ? "YSong API online" : apiState === "offline" ? "YSong API offline" : "Checking YSong API"}
					</div>
					<Link className="dashboard-primary-link" to="/dashboard/niche-intel">
						Open Niche Intel
					</Link>
				</div>
			</header>

			<main className="dashboard-content">
				<section className="dashboard-panel radar-hero-panel">
					<div className="radar-hero-copy">
						<span className="dashboard-micro-label">Quick radar sweeps</span>
						<h2>Use the fast boards for immediate tests, then launch the full atlas when you want the whole genre battlefield.</h2>
						<p>
							Starter 40 and Expanded 80 stay useful for quick comparisons. The new Full Atlas route screens the massive bundled genre dictionary first, then lets YouTube deepen the strongest finalists instead of pretending 80 terms are the whole market.
						</p>
					</div>

					<div className="radar-control-panel">
						<label htmlFor="genre-radar-universe">Quick genre pool</label>
						<select
							disabled={isScanning || atlasRunning}
							id="genre-radar-universe"
							onChange={(event) => setUniverse(event.target.value === "expanded" ? "expanded" : "starter")}
							value={universe}
						>
							<option value="starter">Starter 40 genres</option>
							<option value="expanded">Expanded 80 genres</option>
						</select>

						<label htmlFor="genre-radar-top-count">Show</label>
						<select
							disabled={isScanning || atlasRunning}
							id="genre-radar-top-count"
							onChange={(event) => setTopCount(Number(event.target.value) === 10 ? 10 : 20)}
							value={topCount}
						>
							<option value={10}>Top 10</option>
							<option value={20}>Top 20</option>
						</select>

						<button disabled={!canScan} onClick={() => void runRadarScan()} type="button">
							{isScanning ? "Scanning live lanes…" : scanLabel}
						</button>
						<small>Quick scans are still the light, fast route. The massive atlas sweep lives below.</small>
					</div>
				</section>

				{scanError ? <p className="analysis-error">{scanError}</p> : null}

				<section className="dashboard-metric-grid radar-metric-grid" aria-label="Genre Radar metrics">
					<article className="dashboard-metric-card metric-featured">
						<span>Current board</span>
						<strong>{report ? report.leaderboards.marketHeat.entries.length : "—"}</strong>
						<small>{report ? report.leaderboards.marketHeat.label : "Run a scan to populate the ranked list."}</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Genres scanned</span>
						<strong>{report?.scannedCount.toLocaleString("en-US") ?? "—"}</strong>
						<small>{report ? report.universe.label : "Starter, expanded, and full atlas routes are ready."}</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Atlas dictionary</span>
						<strong>{atlasStats?.totalGenres.toLocaleString("en-US") ?? "—"}</strong>
						<small>{atlasStats ? `${atlasStats.spotifyAtlasGenres.toLocaleString("en-US")} sourced terms + ${atlasStats.localWatchlistAdditions} YSong watchlist additions.` : "Loading massive genre stats."}</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Last scan</span>
						<strong>{report ? (report.cacheState === "cache-hit" ? "Cache" : "Live") : "—"}</strong>
						<small>{reportFreshness}</small>
					</article>
				</section>

				{report?.insights ? (
					<>
						<DailyTargetPanel entry={report.insights.dailyTarget} onBrief={createBrief} onProbe={probeGenre} onSave={saveTarget} />
						<section className="radar-insight-grid">
							<InsightCard entry={report.insights.avoidToday} label="Avoid Today" title="Hot demand, but the visible supply pressure is brutal. Use only if you can niche it down hard." />
							<article className="dashboard-panel radar-insight-card scan-summary-card">
								<span className="dashboard-micro-label">Scan Summary</span>
								<h2>What the board says</h2>
								<ul>
									{report.insights.scanSummary.map((item) => (
										<li key={item}>{item}</li>
									))}
								</ul>
							</article>
						</section>
						<section className="radar-supply-demand-overview">
							<div className="dashboard-panel supply-demand-card">
								<span className="dashboard-micro-label">Supply vs Demand</span>
								<h2>Current target balance</h2>
								{report.insights.dailyTarget ? (
									<>
										<MiniBar label="Demand" value={report.insights.dailyTarget.demand} />
										<MiniBar label="Visible Supply" tone="supply" value={report.insights.dailyTarget.supply} />
										<MiniBar label="Opportunity Gap" tone="gap" value={report.insights.dailyTarget.opportunityGap} />
									</>
								) : null}
							</div>
							<div className="dashboard-panel watchlist-card">
								<span className="dashboard-micro-label">Saved Targets</span>
								<h2>{watchlist.length} watched</h2>
								{watchlist.length ? (
									<div className="watchlist-pill-row">
										{watchlist.slice(0, 8).map((entry) => (
											<button key={`watch-${entry.genre}`} onClick={() => createBrief(entry)} type="button">{entry.genre}</button>
										))}
									</div>
								) : (
									<p>Save promising genres from the leaderboard so they do not vanish after the weld shift.</p>
								)}
							</div>
						</section>
						<LowHangingFruitPanel entries={report.insights.lowHangingFruit} onBrief={createBrief} onProbe={probeGenre} />
						<section className="radar-advanced-grid">
							<ModifierLabPanel entry={report.insights.dailyTarget} onProbe={probeGenre} />
							<QualitySupplyPanel entry={report.insights.dailyTarget} />
							<TrendHistoryPanel history={history} />
						</section>
						{songBrief ? (
							<section className="dashboard-panel song-brief-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Generated Song Brief</span>
										<h2>Copy this into your production workflow.</h2>
									</div>
									<button onClick={() => setSongBrief("")} type="button">Clear</button>
								</div>
								<pre>{songBrief}</pre>
							</section>
						) : null}
					</>
				) : null}

				<section className="dashboard-panel atlas-launch-panel">
					<div className="atlas-launch-copy">
						<span className="dashboard-micro-label">Massive Genre Atlas</span>
						<h2>Screen the full 6,000+ genre dictionary, then deepen the finalists.</h2>
						<p>
							The full path is a two-stage scan: Apple/iTunes screens every dictionary term first, then YouTube refines the top 80 finalists when the YSong managed provider is available. That gives us a massive discovery lane without burning YouTube quota on thousands of low-signal terms.
						</p>
					</div>
					<div className="atlas-launch-actions">
						<button disabled={!canStartAtlas} onClick={() => void beginAtlasSweep()} type="button">
							{atlasRunning ? "Atlas sweep running…" : "Start full atlas sweep"}
						</button>
						<small>
							{atlasStats ? `${atlasStats.totalGenres.toLocaleString("en-US")} total terms are bundled with YSong.` : "Loading atlas dictionary count."}
						</small>
					</div>
				</section>

				{atlasError ? <p className="analysis-error">{atlasError}</p> : null}
				{atlasJob ? <AtlasProgressPanel job={atlasJob} /> : null}

				<section className="dashboard-panel atlas-catalog-panel">
					<div className="dashboard-panel-heading compact">
						<div>
							<span className="dashboard-micro-label">Genre dictionary browser</span>
							<h2>Search the atlas before you scan or probe.</h2>
						</div>
					</div>
					<p className="panel-note">
						The preview opens with the YSong watchlist first, so the weird little gems are visible immediately. Search anything from Freestyle to Norwegian Black Metal, Miami Bass, Electro, Psytrance, or Kentucky Bluegrass.
					</p>
					<div className="atlas-catalog-search">
						<input
							aria-label="Search the genre atlas"
							disabled={apiState !== "online" || isCatalogLoading}
							onChange={(event) => setCatalogQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									void runCatalogSearch();
								}
							}}
							placeholder="Search genres: freestyle, bass techno, electro, cybergoth…"
							type="text"
							value={catalogQuery}
						/>
						<button disabled={apiState !== "online" || isCatalogLoading} onClick={() => void runCatalogSearch()} type="button">
							{isCatalogLoading ? "Searching…" : "Search atlas"}
						</button>
					</div>
					{catalogError ? <p className="analysis-error">{catalogError}</p> : null}
					{catalogResponse ? (
						<>
							<div className="atlas-catalog-summary">
								<strong>{catalogResponse.matchCount.toLocaleString("en-US")} matches</strong>
								<span>
									{catalogResponse.query ? `for “${catalogResponse.query}”` : "in the atlas preview"} · {catalogResponse.totalGenres.toLocaleString("en-US")} total genre terms
								</span>
							</div>
							<div className="atlas-catalog-list">
								{catalogResponse.entries.map((entry) => (
									<CatalogResultRow entry={entry} isBusy={isScanning || isAnalyzing || atlasRunning} key={`${entry.source}-${entry.genre}`} onProbe={probeGenre} />
								))}
							</div>
						</>
					) : null}
				</section>

				{report ? (
					<>
						<section className="dashboard-panel radar-report-summary">
							<div className="dashboard-panel-heading compact">
								<div>
									<span className="dashboard-micro-label">Scan summary</span>
									<h2>
										{report.universe.label}: {report.universe.description}
									</h2>
								</div>
							</div>
							<p>{report.providerSummary}</p>
							{report.scanPlan ? (
								<div className="atlas-scan-plan">
									<span>{report.scanPlan.coarseProvider}</span>
									<span>{report.scanPlan.refineProvider}</span>
									<span>{report.scanPlan.refinedCount.toLocaleString("en-US")} finalists refined</span>
								</div>
							) : null}
							<div className="radar-note-row">
								{report.notes.map((note) => (
									<span key={note}>{note}</span>
								))}
							</div>
						</section>

						<section className="radar-leaderboard-grid">
							<LeaderboardPanel isBusy={isScanning || isAnalyzing || atlasRunning} leaderboard={report.leaderboards.marketHeat} onBrief={createBrief} onProbe={probeGenre} onSave={saveTarget} />
							<LeaderboardPanel isBusy={isScanning || isAnalyzing || atlasRunning} leaderboard={report.leaderboards.opportunity} onBrief={createBrief} onProbe={probeGenre} onSave={saveTarget} />
							{report.leaderboards.opportunityGap ? <LeaderboardPanel isBusy={isScanning || isAnalyzing || atlasRunning} leaderboard={report.leaderboards.opportunityGap} onBrief={createBrief} onProbe={probeGenre} onSave={saveTarget} /> : null}
						</section>
					</>
				) : (
					<section className="dashboard-empty-report-grid">
						<article className="dashboard-panel dashboard-empty-report-card">
							<span className="dashboard-micro-label">Genre Radar awaits</span>
							<h2>Run a quick sweep or launch the full atlas.</h2>
							<p>
								The quick boards give immediate comparisons. The massive atlas sweep is the feature that stops us from blindly tossing genre terms and praying.
							</p>
						</article>
						<article className="dashboard-panel dashboard-empty-state">
							<strong>Starter 40 is still the best five-second test.</strong>
							<p>The full atlas is the bedtime / heavy scan route. Use it when you want dictionary-scale discovery instead of a curated sample.</p>
							<button className="dashboard-primary-link inline-action radar-empty-action" disabled={!canScan} onClick={() => void runRadarScan("starter", topCount)} type="button">
								{isScanning ? "Scanning…" : "Scan starter 40"}
							</button>
						</article>
					</section>
				)}
			</main>
		</>
	);
}

export default GenreRadarPage;
