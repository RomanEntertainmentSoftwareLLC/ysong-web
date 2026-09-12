/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createReleaseOutcome, downloadSeoServerCsv, fetchMlPrediction, fetchMlStatus, fetchReleaseOutcomes } from "../../api/musicIntelClient";
import type { MlPrediction, MlStatus, ReleaseOutcome, ReleaseOutcomeInput } from "../../types/musicIntel";
import { useDashboardWorkspace } from "../DashboardWorkspaceContext";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function numberFromInput(value: FormDataEntryValue | null, fallback: number): number {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) ? numericValue : fallback;
}

function MlLabPage() {
	const { apiState, report } = useDashboardWorkspace();
	const [status, setStatus] = useState<MlStatus | null>(null);
	const [prediction, setPrediction] = useState<MlPrediction | null>(null);
	const [outcomes, setOutcomes] = useState<ReleaseOutcome[]>([]);
	const [message, setMessage] = useState<string | null>(null);

	const currentTarget = useMemo(() => {
		if (!report) return null;
		const supply = Math.max(0, Math.min(100, Math.round(report.scores.competition * 0.72 + report.scores.demand * 0.18)));
		const opportunityGap = Math.max(0, Math.min(100, Math.round(report.scores.demand * 0.38 + report.scores.momentum * 0.27 + (100 - supply) * 0.35)));
		return {
			genre: report.query,
			demand: report.scores.demand,
			supply,
			momentum: report.scores.momentum,
			competition: report.scores.competition,
			opportunityGap,
		};
	}, [report]);

	async function refreshLab(): Promise<void> {
		const [nextStatus, nextOutcomes] = await Promise.all([fetchMlStatus(), fetchReleaseOutcomes()]);
		setStatus(nextStatus);
		setOutcomes(nextOutcomes);
		if (currentTarget) {
			setPrediction(await fetchMlPrediction(currentTarget));
		}
	}

	useEffect(() => {
		void refreshLab().catch(() => setMessage("ML Lab could not reach the YSong API yet."));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentTarget?.genre]);

	async function submitOutcome(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		const input: ReleaseOutcomeInput = {
			title: String(formData.get("title") || "Untitled release"),
			genre: String(formData.get("genre") || currentTarget?.genre || "Unknown genre"),
			platform: String(formData.get("platform") || "YouTube"),
			releaseDate: String(formData.get("releaseDate") || today()),
			demand: numberFromInput(formData.get("demand"), currentTarget?.demand ?? 50),
			supply: numberFromInput(formData.get("supply"), currentTarget?.supply ?? 50),
			momentum: numberFromInput(formData.get("momentum"), currentTarget?.momentum ?? 50),
			competition: numberFromInput(formData.get("competition"), currentTarget?.competition ?? 50),
			opportunityGap: numberFromInput(formData.get("opportunityGap"), currentTarget?.opportunityGap ?? 50),
			views24h: numberFromInput(formData.get("views24h"), 0),
			views7d: numberFromInput(formData.get("views7d"), 0),
			views30d: numberFromInput(formData.get("views30d"), 0),
			streams30d: numberFromInput(formData.get("streams30d"), 0),
			revenue30d: numberFromInput(formData.get("revenue30d"), 0),
			notes: String(formData.get("notes") || ""),
		};

		await createReleaseOutcome(input);
		setMessage("Outcome saved. This becomes private training data for your YSong SEO predictor.");
		event.currentTarget.reset();
		await refreshLab();
	}

	return (
		<>
			<header className="dashboard-topbar">
				<div>
					<span className="dashboard-kicker">ML Lab</span>
					<h1>Outcome learning loop</h1>
				</div>

				<div className="dashboard-status-cluster">
					<div className={`dashboard-status-pill api-state-${apiState}`}>
						<span />
						{apiState === "online" ? "YSong API online" : apiState === "offline" ? "YSong API offline" : "Checking YSong API"}
					</div>
					<button className="dashboard-primary-link" type="button" onClick={() => void downloadSeoServerCsv("outcomes").catch(() => setMessage("Could not export outcomes CSV."))}>Export outcomes CSV</button>
				</div>
			</header>

			<main className="dashboard-content">
				<section className="dashboard-panel ml-hero-panel">
					<div>
						<span className="dashboard-micro-label">Outcome learning</span>
						<h2>Analytics become useful when releases teach the system what actually worked.</h2>
						<p className="panel-note">YSong stores your release outcomes per account and uses them to improve the prediction loop. The current predictor stays transparent until enough real outcomes exist for a trained model.</p>
					</div>
					<div className="ml-status-card">
						<strong>{status?.localData.usableOutcomes ?? 0}</strong>
						<span>usable outcome rows</span>
						<small>{status?.recommendation || "Waiting for ML status."}</small>
					</div>
				</section>

				<section className="ml-grid-two">
					<article className="dashboard-panel">
						<span className="dashboard-micro-label">Prediction score</span>
						<h2>{prediction?.genre || currentTarget?.genre || "Run a Niche Intel probe first"}</h2>
						{prediction ? (
							<>
								<div className="ml-big-score">{prediction.predictedPerformance}</div>
								<p className="panel-note">Confidence: {prediction.confidence}. Mode: {prediction.modelMode}. {prediction.note}</p>
								<div className="ml-driver-list">
									{prediction.drivers.map((driver) => (
										<div key={driver.feature}>
											<span>{driver.feature}</span>
											<strong>{driver.impact}</strong>
											<i style={{ width: `${driver.impact}%` }} />
										</div>
									))}
								</div>
							</>
						) : (
							<p className="panel-note">Run a genre or niche report first, then ML Lab can score that target as a future release candidate.</p>
						)}
					</article>

					<article className="dashboard-panel">
						<span className="dashboard-micro-label">Model training</span>
						<h2>The learning loop is ready before the trained model is.</h2>
						<p className="panel-note">YSong preserves the original outcome-tracking and transparent prediction logic without making users launch a second service.</p>
						<div className="ml-command-box">
							Collect real release outcomes → build a usable dataset → train and validate a model → enable it behind the same YSong API.
						</div>
						<p className="panel-note">Until then, predictions stay explicitly labeled as heuristic or ML-ready fallback scores.</p>
					</article>
				</section>

				<section className="dashboard-panel">
					<div className="dashboard-panel-heading compact">
						<div>
							<span className="dashboard-micro-label">Outcome tracker</span>
							<h2>Log release results so the model has something real to learn.</h2>
						</div>
					</div>
					{message ? <p className="ml-save-message">{message}</p> : null}
					<form className="ml-outcome-form" onSubmit={(event) => void submitOutcome(event)}>
						<input name="title" placeholder="Song / release title" />
						<input defaultValue={currentTarget?.genre || ""} name="genre" placeholder="Genre / niche" />
						<select name="platform" defaultValue="YouTube">
							<option>YouTube</option>
							<option>Spotify</option>
							<option>Apple</option>
							<option>DistroKid / blended</option>
						</select>
						<input defaultValue={today()} name="releaseDate" type="date" />
						<input defaultValue={currentTarget?.demand ?? 50} name="demand" placeholder="Demand" type="number" />
						<input defaultValue={currentTarget?.supply ?? 50} name="supply" placeholder="Supply" type="number" />
						<input defaultValue={currentTarget?.momentum ?? 50} name="momentum" placeholder="Momentum" type="number" />
						<input defaultValue={currentTarget?.competition ?? 50} name="competition" placeholder="Competition" type="number" />
						<input defaultValue={currentTarget?.opportunityGap ?? 50} name="opportunityGap" placeholder="Gap" type="number" />
						<input name="views24h" placeholder="Views 24h" type="number" />
						<input name="views7d" placeholder="Views 7d" type="number" />
						<input name="views30d" placeholder="Views 30d" type="number" />
						<input name="streams30d" placeholder="Streams 30d" type="number" />
						<input name="revenue30d" placeholder="Revenue 30d" type="number" />
						<textarea name="notes" placeholder="Notes: thumbnail, title, prompt, weird drift, metadata angle..." />
						<button className="dashboard-primary-link" type="submit">Save outcome</button>
					</form>
				</section>

				<section className="dashboard-panel">
					<div className="dashboard-panel-heading compact">
						<div>
							<span className="dashboard-micro-label">Recent outcomes</span>
							<h2>{outcomes.length} release rows</h2>
						</div>
						<button className="dashboard-primary-link" type="button" onClick={() => void downloadSeoServerCsv("scans").catch(() => setMessage("Could not export scan CSV."))}>Export scan CSV</button>
					</div>
					<div className="keyword-table keyword-table-expanded">
						<div className="keyword-table-header"><span>Title</span><span>Genre</span><span>Platform</span><span>30d result</span></div>
						{outcomes.slice(0, 10).map((outcome) => (
							<div className="keyword-table-row" key={outcome.id}>
								<strong>{outcome.title}</strong><span>{outcome.genre}</span><span>{outcome.platform}</span><span>{outcome.views30d || outcome.streams30d || outcome.views7d}</span>
							</div>
						))}
						{outcomes.length === 0 ? <p className="panel-note">No outcomes logged yet. This is where the compounding loop starts.</p> : null}
					</div>
				</section>
			</main>
		</>
	);
}

export default MlLabPage;
