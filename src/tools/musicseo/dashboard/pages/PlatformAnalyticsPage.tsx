import { Link } from "react-router";
import { groupHighlightsByPlatform } from "../dashboardUtils";
import { useDashboardWorkspace } from "../DashboardWorkspaceContext";

function PlatformAnalyticsPage() {
	const { apiState, providerStatusCards, report } = useDashboardWorkspace();
	const groupedHighlights = report ? groupHighlightsByPlatform(report.highlights) : {};

	return (
		<>
			<header className="dashboard-topbar">
				<div>
					<span className="dashboard-kicker">Platform Analytics</span>
					<h1>Provider lanes and live market evidence</h1>
				</div>

				<div className="dashboard-status-cluster">
					<div className={`dashboard-status-pill api-state-${apiState}`}>
						<span />
						{apiState === "online" ? "YSong API online" : apiState === "offline" ? "YSong API offline" : "Checking YSong API"}
					</div>
					<Link className="dashboard-primary-link" to="/dashboard/niche-intel">
						Run a probe
					</Link>
				</div>
			</header>

			<main className="dashboard-content">
				<section className="dashboard-panel platform-intro-panel">
					<div className="dashboard-panel-heading compact">
						<div>
							<span className="dashboard-micro-label">Provider state</span>
							<h2>What the YSong backend can currently see</h2>
						</div>
					</div>
					<p className="panel-note">
						Apple catalog search is available without a key. YouTube and Spotify use YSong-managed server credentials when those provider lanes are configured.
					</p>

					<div className="dashboard-provider-grid">
						{providerStatusCards.map((provider) => (
							<article className={`dashboard-panel provider-health-card provider-${provider.state}`} key={provider.platform}>
								<div>
									<span className="dashboard-micro-label">{provider.platform}</span>
									<h2>{provider.label}</h2>
								</div>
								<p>{provider.detail}</p>
								<strong>{provider.state === "live" ? "Ready" : provider.state === "error" ? "Provider error" : "Waiting on credentials"}</strong>
							</article>
						))}
					</div>
				</section>

				{report ? (
					<>
						<section className="dashboard-panel">
							<div className="dashboard-panel-heading compact">
								<div>
									<span className="dashboard-micro-label">Current report pulse</span>
									<h2>{report.query}</h2>
								</div>
							</div>
							<p className="panel-note">These scores are comparative heuristics built from the live provider surfaces returned for the current report.</p>

							<div className="platform-card-stack analytics-platform-stack">
								{report.platformSignals.map((signal) => (
									<div className="platform-signal-card" key={signal.platform}>
										<div>
											<strong>{signal.platform}</strong>
											<span>{signal.status}</span>
										</div>
										<b>{signal.score}</b>
										<p>{signal.insight}</p>
									</div>
								))}
							</div>
						</section>

						<section className="dashboard-provider-highlight-grid">
							{Object.entries(groupedHighlights).map(([platform, highlights]) => (
								<article className="dashboard-panel" key={platform}>
									<div className="dashboard-panel-heading compact">
										<div>
											<span className="dashboard-micro-label">Live result samples</span>
											<h2>{platform}</h2>
										</div>
									</div>

									<div className="highlight-list">
										{highlights.map((highlight) => {
											const content = (
												<>
													<div>
														<span>{highlight.platform}</span>
														<strong>{highlight.title}</strong>
														<small>{highlight.subtitle}</small>
													</div>
													<b>
														{highlight.metricLabel}: {highlight.metricValue}
													</b>
												</>
											);

											return highlight.url ? (
												<a className="highlight-row" href={highlight.url} key={`${highlight.platform}-${highlight.title}`} rel="noreferrer" target="_blank">
													{content}
												</a>
											) : (
												<div className="highlight-row" key={`${highlight.platform}-${highlight.title}`}>
													{content}
												</div>
											);
										})}
									</div>
								</article>
							))}
						</section>
					</>
				) : (
					<section className="dashboard-empty-report-grid">
						<article className="dashboard-panel dashboard-empty-report-card">
							<span className="dashboard-micro-label">No active report</span>
							<h2>Run Niche Intel first.</h2>
							<p>
								This page becomes juicy after a live probe exists. It will separate what Apple, YouTube, and later Spotify contributed instead of burying everything inside one blended verdict.
							</p>
						</article>
						<article className="dashboard-panel dashboard-empty-state">
							<strong>Provider analytics are staged and ready.</strong>
							<p>Run a niche search, then return here to inspect live evidence lane by lane.</p>
							<Link className="dashboard-primary-link inline-action" to="/dashboard/niche-intel">
								Open Niche Intel
							</Link>
						</article>
					</section>
				)}
			</main>
		</>
	);
}

export default PlatformAnalyticsPage;
