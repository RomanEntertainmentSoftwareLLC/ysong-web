import { Link } from "react-router";
import { useDashboardWorkspace } from "../DashboardWorkspaceContext";

function KeywordIntelPage() {
	const { apiState, report } = useDashboardWorkspace();

	return (
		<>
			<header className="dashboard-topbar">
				<div>
					<span className="dashboard-kicker">Keyword Intel</span>
					<h1>Search angles worth testing next</h1>
				</div>

				<div className="dashboard-status-cluster">
					<div className={`dashboard-status-pill api-state-${apiState}`}>
						<span />
						{apiState === "online" ? "YSong API online" : apiState === "offline" ? "YSong API offline" : "Checking YSong API"}
					</div>
					<Link className="dashboard-primary-link" to="/dashboard/niche-intel">
						Run a new probe
					</Link>
				</div>
			</header>

			<main className="dashboard-content">
				<section className="dashboard-panel keyword-intel-intro">
					<div className="dashboard-panel-heading compact">
						<div>
							<span className="dashboard-micro-label">Keyword research lane</span>
							<h2>Currently signal-derived, later true keyword intelligence.</h2>
						</div>
					</div>
					<p className="panel-note">
						This page now has a real destination in the app. Today it exposes smart follow-up probes generated from the current live report. Later, this is where we plug in actual keyword-volume, competition, and search-trend providers without turning the project into a cloud subscription trap.
					</p>
				</section>

				{report ? (
					<>
						<section className="dashboard-panel">
							<div className="dashboard-panel-heading compact">
								<div>
									<span className="dashboard-micro-label">Current query family</span>
									<h2>{report.query}</h2>
								</div>
							</div>
							<p className="panel-note">These probe ideas inherit the blended live report posture. They are not paid keyword-volume results yet, so the UI stays honest.</p>

							<div className="keyword-table keyword-table-expanded">
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
						</section>

						<section className="keyword-strategy-grid">
							<article className="dashboard-panel keyword-strategy-card">
								<span className="dashboard-micro-label">How to read this</span>
								<h2>Momentum is not the same thing as opportunity.</h2>
								<p>
									A phrase can be active and still be too crowded. The current expansion model nudges you toward adjacent, long-tail, and creator-facing variants that may deserve a separate full Niche Intel probe.
								</p>
							</article>

							<article className="dashboard-panel keyword-strategy-card">
								<span className="dashboard-micro-label">Next real upgrade</span>
								<h2>Paid keyword provider optional, not required.</h2>
								<p>
									When we decide it is worth it, this module can absorb search volume, CPC, and trend curves. Until then, it remains useful without charging you rent.
								</p>
							</article>
						</section>
					</>
				) : (
					<section className="dashboard-empty-report-grid">
						<article className="dashboard-panel dashboard-empty-report-card">
							<span className="dashboard-micro-label">No keyword source yet</span>
							<h2>Generate a niche report first.</h2>
							<p>
								Keyword Intel piggybacks on the latest live provider blend, turning a market probe into a list of targeted follow-up search angles.
							</p>
						</article>
						<article className="dashboard-panel dashboard-empty-state">
							<strong>The page is wired and waiting.</strong>
							<p>Once a report exists, this module shows the expansion table and the next angles worth checking.</p>
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

export default KeywordIntelPage;
