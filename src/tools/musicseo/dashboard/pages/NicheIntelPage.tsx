import type { FormEvent } from "react";
import { Link } from "react-router";
import { buildTrendArea, buildTrendPolyline, formatGeneratedAt, getScoreRows, ScoreGauge } from "../dashboardUtils";
import { useDashboardWorkspace } from "../DashboardWorkspaceContext";

const presetQueries = ["dark gothic techno", "sleep piano", "female symphonic metal", "cyberpunk dubstep"];

function NicheIntelPage() {
	const {
		apiState,
		health,
		query,
		setQuery,
		report,
		recentSearches,
		hasUserSearched,
		isAnalyzing,
		analysisError,
		runAnalysis,
		clearWorkspaceReport,
		configuredProviderCount,
	} = useDashboardWorkspace();

	const providersTotal = health?.providers.length ?? 3;
	const scoreRows = report ? getScoreRows(report.scores) : [];
	const providerSignalByPlatform = new Map(report?.platformSignals.map((signal) => [signal.platform, signal]) ?? []);
	const trendLine = report ? buildTrendPolyline(report.trend) : "";
	const trendArea = report ? buildTrendArea(report.trend) : "";

	async function submitAnalysis(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		await runAnalysis(query);
	}

	async function runPreset(search: string): Promise<void> {
		setQuery(search);
		await runAnalysis(search);
	}

	return (
		<>
			<header className="dashboard-topbar">
				<div>
					<span className="dashboard-kicker">Niche Intel</span>
					<h1>Cross-platform opportunity probe</h1>
				</div>

				<div className="dashboard-status-cluster">
					<div className={`dashboard-status-pill api-state-${apiState}`}>
						<span />
						{apiState === "online" ? "YSong API online" : apiState === "offline" ? "YSong API offline" : "Checking YSong API"}
					</div>

					<button className="dashboard-muted-button" onClick={clearWorkspaceReport} type="button">
						Clear report
					</button>
				</div>
			</header>

			<main className="dashboard-content">
				<section className="dashboard-hero-card">
					<div className="dashboard-hero-copy">
						<span className="dashboard-micro-label">Search workspace</span>
						<h2>Ask one niche question. Blend the live provider lanes that actually answer.</h2>
						<p>
							Apple/iTunes catalog search works without a key. YouTube and Spotify join the read through YSong-managed provider credentials when configured.
						</p>
					</div>

					<form className="dashboard-search-panel" onSubmit={(event) => void submitAnalysis(event)}>
						<label htmlFor="niche-intel-search">Niche, genre, mood, or market probe</label>

						<div className="dashboard-search-row">
							<input
								id="niche-intel-search"
								onChange={(event) => setQuery(event.target.value)}
								placeholder='Try: "dark gothic techno", "sleep piano", "female symphonic metal"'
								type="text"
								value={query}
							/>

							<button disabled={apiState !== "online" || isAnalyzing || !query.trim()} type="submit">
								{isAnalyzing ? "Analyzing…" : "Analyze"}
							</button>
						</div>

						<div className="dashboard-preset-row" aria-label="Suggested niche searches">
							{presetQueries.map((search) => (
								<button disabled={isAnalyzing || apiState !== "online"} key={search} onClick={() => void runPreset(search)} type="button">
									{search}
								</button>
							))}
						</div>

						{analysisError ? <p className="analysis-error">{analysisError}</p> : null}
					</form>
				</section>

				<section className="dashboard-metric-grid" aria-label="Niche intelligence metrics">
					<article className="dashboard-metric-card metric-featured">
						<span>Opportunity score</span>
						<strong>{report?.scores.opportunity ?? "—"}</strong>
						<small>{report ? report.verdict.label : "Run a live probe to score a lane."}</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Saved local searches</span>
						<strong>{recentSearches.length}</strong>
						<small>Persisted in browser localStorage for this private dashboard.</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Providers ready</span>
						<strong>
							{configuredProviderCount} / {providersTotal}
						</strong>
						<small>Readiness is measured from the YSong API health check.</small>
					</article>

					<article className="dashboard-metric-card">
						<span>Data mode</span>
						<strong>{report?.meta.dataMode === "live-full" ? "Full" : report ? "Partial" : "—"}</strong>
						<small>{report ? report.meta.sourceSummary : "No provider report generated yet."}</small>
					</article>
				</section>

				{!report ? (
					<section className="dashboard-empty-report-grid">
						<article className="dashboard-panel dashboard-empty-report-card">
							<span className="dashboard-micro-label">Report status</span>
							<h2>{hasUserSearched ? "The last analysis did not produce a saved report." : "No live niche report yet."}</h2>
							<p>
								Run a search above and YSong will build a report from the provider lanes that answer. Apple works immediately; YouTube and Spotify are handled by the YSong backend when configured.
							</p>
						</article>

						<article className="dashboard-panel dashboard-empty-state">
							<strong>What will appear here</strong>
							<p>
								Verdict grade, score breakdown, provider pulse, live result samples, signal-derived keyword expansions, and the reasoning trail behind the read.
							</p>
							<Link className="dashboard-primary-link inline-action" to="/dashboard/platform-analytics">
								Review provider readiness
							</Link>
						</article>
					</section>
				) : (
					<>
						<section className="dashboard-intel-grid">
							<article className={`dashboard-panel verdict-panel verdict-${report.verdict.tone}`}>
								<div className="dashboard-panel-heading verdict-heading">
									<div>
										<span className="dashboard-micro-label">Niche verdict</span>
										<h2>{report.query}</h2>
									</div>
									<strong className="verdict-grade">{report.verdict.grade}</strong>
								</div>

								<div className="verdict-body">
									<ScoreGauge label="Opportunity score" score={report.scores.opportunity} />

									<div className="verdict-copy">
										<strong>{report.verdict.label}</strong>
										<p>{report.verdict.summary}</p>
										<p className="prototype-callout">
											{report.meta.dataMode === "live-full" ? "All provider lanes answered this probe." : "Partial live provider blend"} · generated {formatGeneratedAt(report.meta.generatedAt)}.
										</p>
									</div>
								</div>
							</article>

							<article className="dashboard-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Score breakdown</span>
										<h2>What the live heuristic sees</h2>
									</div>
								</div>

								<div className="score-row-stack">
									{scoreRows.map((row) => (
										<div className="score-row" key={row.label}>
											<div className="score-row-copy">
												<strong>{row.label}</strong>
												<span>{row.description}</span>
											</div>
											<div className="score-row-value">
												<strong>{row.value}</strong>
												<div className="score-track">
													<span style={{ width: `${row.value}%` }} />
												</div>
											</div>
										</div>
									))}
								</div>
							</article>
						</section>

						<section className="dashboard-signal-grid">
							<article className="dashboard-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Signal trace</span>
										<h2>Demand → momentum → whitespace → opportunity</h2>
									</div>
								</div>

								<div className="trend-chart-shell">
									<svg preserveAspectRatio="none" viewBox="0 0 100 100" aria-label="Signal trace chart" role="img">
										<polygon className="trend-area" points={trendArea} />
										<polyline className="trend-line" points={trendLine} />
									</svg>
								</div>

								<div className="trend-label-row">
									{report.trend.map((point) => (
										<span key={point.label}>
											<strong>{point.label}</strong>
											<small>{point.value}</small>
										</span>
									))}
								</div>
							</article>

							<article className="dashboard-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Provider pulse</span>
										<h2>What each live lane contributed</h2>
									</div>
								</div>

								<div className="platform-card-stack">
									{report.meta.providerStatuses.map((provider) => {
										const signal = providerSignalByPlatform.get(provider.platform);
										return (
											<div className={`platform-signal-card provider-${provider.state}`} key={provider.platform}>
												<div>
													<strong>{provider.platform}</strong>
													<span>{provider.label}</span>
												</div>
												<b>{signal?.score ?? 0}</b>
												<p>{provider.detail}</p>
											</div>
										);
									})}
								</div>
							</article>
						</section>

						<section className="dashboard-workspace-grid">
							<article className="dashboard-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Follow-up probes</span>
										<h2>Query expansions generated from the current signal mix</h2>
									</div>
								</div>
								<p className="panel-note">These are heuristic next searches, not paid keyword-volume results yet.</p>

								<div className="keyword-table">
									<div className="keyword-table-header">
										<span>Phrase</span>
										<span>Angle</span>
										<span>Momentum</span>
										<span>Competition</span>
									</div>
									{report.keywordIdeas.map((idea) => (
										<div className="keyword-table-row" key={idea.term}>
											<strong>{idea.term}</strong>
											<span>{idea.angle}</span>
											<span>{idea.momentum}</span>
											<span>{idea.competition}</span>
										</div>
									))}
								</div>
							</article>

							<aside className="dashboard-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Recent searches</span>
										<h2>Search history</h2>
									</div>
								</div>

								{recentSearches.length === 0 ? (
									<div className="dashboard-empty-state compact-empty-state">
										<strong>No searches saved.</strong>
										<p>This dashboard stores recent probes only in your browser.</p>
									</div>
								) : (
									<div className="recent-search-list">
										{recentSearches.map((search) => (
											<button disabled={isAnalyzing} key={search} onClick={() => void runAnalysis(search)} type="button">
												<span>{search}</span>
												<strong>{isAnalyzing ? "Running" : "Re-run"}</strong>
											</button>
										))}
									</div>
								)}
							</aside>
						</section>

						<section className="dashboard-lower-grid">
							<article className="dashboard-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Reasoning layer</span>
										<h2>Why the app scored this lane this way</h2>
									</div>
								</div>

								<div className="reason-list">
									{report.reasons.map((reason) => (
										<p key={reason}>{reason}</p>
									))}
								</div>
							</article>

							<article className="dashboard-panel">
								<div className="dashboard-panel-heading compact">
									<div>
										<span className="dashboard-micro-label">Live result samples</span>
										<h2>Provider items proving the backend fetched something</h2>
									</div>
								</div>

								{report.highlights.length === 0 ? (
									<div className="dashboard-empty-state compact-empty-state">
										<strong>No provider samples returned.</strong>
										<p>The provider lanes answered, but no displayable highlight rows were available.</p>
									</div>
								) : (
									<div className="highlight-list">
										{report.highlights.slice(0, 8).map((highlight) => {
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
								)}
							</article>
						</section>
					</>
				)}
			</main>
		</>
	);
}

export default NicheIntelPage;
