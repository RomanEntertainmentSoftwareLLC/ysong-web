import { Link, useNavigate } from "react-router";
import { formatGeneratedAt } from "../dashboardUtils";
import { useDashboardWorkspace } from "../DashboardWorkspaceContext";

const modules = [

	{
		code: "GR",
		title: "Genre Radar",
		description: "Live top-genre leaderboards that compare a curated candidate pool instead of making you type blind guesses.",
		to: "/dashboard/genre-radar",
	},
	{
		code: "KI",
		title: "Keyword Intelligence",
		description: "Follow-up probe ideas and signal-derived phrase expansions live here next.",
		to: "/dashboard/keyword-intel",
	},
	{
		code: "ML",
		title: "ML Lab",
		description: "Outcome tracking and a staged learning loop for release performance.",
		to: "/dashboard/ml-lab",
	},
	{
		code: "PA",
		title: "Platform Analytics",
		description: "Provider pulse cards, live result samples, and lane-by-lane evidence stay together.",
		to: "/dashboard/platform-analytics",
	},
	{
		code: "NI",
		title: "Niche Intel",
		description: "The full cross-provider search, score, verdict, and reasoning workspace.",
		to: "/dashboard/niche-intel",
	},
];

function OverviewPage() {
	const navigate = useNavigate();
	const {
		apiState,
		health,
		report,
		recentSearches,
		runAnalysis,
		configuredProviderCount,
		providerStatusCards,
		isAnalyzing,
	} = useDashboardWorkspace();

	const providersTotal = health?.providers.length ?? 3;
	const savedOpportunityScore = report?.scores.opportunity;

	async function rerunSearch(search: string): Promise<void> {
		const nextReport = await runAnalysis(search);
		if (nextReport) {
			navigate("/dashboard/niche-intel");
		}
	}

	return (
		<>
			<header className="dashboard-topbar">
				<div>
					<span className="dashboard-kicker">Overview</span>
					<h1>Music Intelligence Dashboard</h1>
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
				<section className="dashboard-overview-hero dashboard-panel">
					<div>
						<span className="dashboard-micro-label">YSong command center</span>
						<h2>Music market intelligence, now native inside YSong.</h2>
						<p>
							Genre Radar ranks candidate genres from live provider evidence, Niche Intel drills into one lane, Platform Analytics separates the evidence, and Exports keeps the report portable. Provider credentials stay on the YSong server.
						</p>
					</div>

					<div className="dashboard-overview-actions">
						<Link className="dashboard-hero-action" to="/dashboard/genre-radar">
							Scan genre radar
						</Link>
						<Link className="dashboard-hero-action secondary" to="/dashboard/niche-intel">
							Run a niche probe
						</Link>
					</div>
				</section>

				<section className="dashboard-metric-grid" aria-label="Dashboard metrics">
					<article className="dashboard-metric-card">
						<span>Last opportunity score</span>
						<strong>{savedOpportunityScore ?? "—"}</strong>
						<small>{report ? `Last report: ${report.query}` : "No live report has been saved yet."}</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Saved local searches</span>
						<strong>{recentSearches.length}</strong>
						<small>Persisted in browser localStorage for this private workspace.</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Providers ready</span>
						<strong>
							{configuredProviderCount} / {providersTotal}
						</strong>
						<small>Apple works without credentials; YouTube and Spotify appear when YSong managed providers are configured.</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Provider mode</span>
						<strong>Managed</strong>
						<small>YSong keeps provider secrets server-side instead of exposing API keys in the browser.</small>
					</article>
				</section>

				<section className="dashboard-overview-grid">
					<article className="dashboard-panel overview-provider-panel">
						<div className="dashboard-panel-heading compact">
							<div>
								<span className="dashboard-micro-label">Provider readiness</span>
								<h2>What is actually connected</h2>
							</div>
						</div>

						<div className="overview-provider-list">
							{providerStatusCards.map((provider) => (
								<div className={`overview-provider-row provider-${provider.state}`} key={provider.platform}>
									<div>
										<strong>{provider.platform}</strong>
										<span>{provider.label}</span>
									</div>
									<p>{provider.detail}</p>
								</div>
							))}
						</div>
					</article>

					<article className="dashboard-panel overview-recent-panel">
						<div className="dashboard-panel-heading compact">
							<div>
								<span className="dashboard-micro-label">Recent searches</span>
								<h2>Jump back in</h2>
							</div>
						</div>

						{recentSearches.length === 0 ? (
							<div className="dashboard-empty-state compact-empty-state">
								<strong>No search history yet.</strong>
								<p>Run a niche probe and this workspace will preserve the breadcrumb trail locally.</p>
							</div>
						) : (
							<div className="recent-search-list">
								{recentSearches.map((search) => (
									<button disabled={isAnalyzing} key={search} onClick={() => void rerunSearch(search)} type="button">
										<span>{search}</span>
										<strong>{isAnalyzing ? "Running" : "Re-run"}</strong>
									</button>
								))}
							</div>
						)}
					</article>
				</section>

				<section className="dashboard-panel overview-last-report-panel">
					<div className="dashboard-panel-heading compact">
						<div>
							<span className="dashboard-micro-label">Latest intelligence</span>
							<h2>{report ? report.query : "No report generated yet"}</h2>
						</div>
					</div>

					{report ? (
						<div className="overview-report-summary">
							<div className="overview-report-grade">
								<strong>{report.verdict.grade}</strong>
								<span>{report.verdict.label}</span>
							</div>

							<div className="overview-report-copy">
								<p>{report.verdict.summary}</p>
								<small>
									Saved {formatGeneratedAt(report.meta.generatedAt)} · {report.meta.sourceSummary}
								</small>
							</div>

							<div className="overview-report-actions">
								<Link to="/dashboard/niche-intel">Open full report</Link>
								<Link to="/dashboard/exports">Export it</Link>
							</div>
						</div>
					) : (
						<div className="dashboard-empty-state compact-empty-state">
							<strong>The workspace is ready.</strong>
							<p>Head into Niche Intel to create the first report powered by the YSong music-intelligence backend.</p>
						</div>
					)}
				</section>

				<section className="dashboard-module-grid overview-module-grid">
					{modules.map((module) => (
						<Link className="dashboard-module-card overview-module-card" key={module.title} to={module.to}>
							<div className="dashboard-module-top">
								<span className="dashboard-module-code">{module.code}</span>
								<small>Open</small>
							</div>
							<h3>{module.title}</h3>
							<p>{module.description}</p>
						</Link>
					))}
				</section>
			</main>
		</>
	);
}

export default OverviewPage;
