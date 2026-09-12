import { Link } from "react-router";
import { useDashboardWorkspace } from "../DashboardWorkspaceContext";
import type { NicheIntelReport } from "../../types/musicIntel";

function safeFileStem(query: string): string {
	const normalized = query
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 72);
	return normalized || "ysong-seo-report";
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number): string {
	const text = String(value);
	return `"${text.replace(/"/g, '""')}"`;
}

function buildKeywordCsv(report: NicheIntelReport): string {
	const rows = [
		["Query", "Angle", "Momentum", "Competition"],
		...report.keywordIdeas.map((idea) => [idea.term, idea.angle, idea.momentum, idea.competition]),
	];
	return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function buildPlatformCsv(report: NicheIntelReport): string {
	const rows = [
		["Platform", "Score", "Status", "Insight"],
		...report.platformSignals.map((signal) => [signal.platform, signal.score, signal.status, signal.insight]),
	];
	return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function buildPlainTextSummary(report: NicheIntelReport): string {
	const reasonLines = report.reasons.map((reason) => `- ${reason}`).join("\n");
	const providerLines = report.platformSignals
		.map((signal) => `- ${signal.platform}: ${signal.score}/100 — ${signal.status}. ${signal.insight}`)
		.join("\n");
	const keywordLines = report.keywordIdeas
		.map((idea) => `- ${idea.term} | ${idea.angle} | momentum ${idea.momentum} | competition ${idea.competition}`)
		.join("\n");

	return [
		"YSong SEO Intelligence Report",
		"==========================",
		`Query: ${report.query}`,
		`Generated: ${report.meta.generatedAt}`,
		`Mode: ${report.meta.dataMode}`,
		`Source summary: ${report.meta.sourceSummary}`,
		"",
		`Verdict: ${report.verdict.grade} — ${report.verdict.label}`,
		report.verdict.summary,
		"",
		"Scores",
		`Demand: ${report.scores.demand}/100`,
		`Momentum: ${report.scores.momentum}/100`,
		`Competition: ${report.scores.competition}/100`,
		`Opportunity: ${report.scores.opportunity}/100`,
		"",
		"Reasoning",
		reasonLines,
		"",
		"Provider pulse",
		providerLines,
		"",
		"Follow-up probes",
		keywordLines,
	].join("\n");
}

function ExportsPage() {
	const { apiState, report } = useDashboardWorkspace();
	const stem = report ? safeFileStem(report.query) : "ysong-seo-report";

	return (
		<>
			<header className="dashboard-topbar">
				<div>
					<span className="dashboard-kicker">Exports</span>
					<h1>Keep the intelligence portable</h1>
				</div>

				<div className="dashboard-status-cluster">
					<div className={`dashboard-status-pill api-state-${apiState}`}>
						<span />
						{apiState === "online" ? "YSong API online" : apiState === "offline" ? "YSong API offline" : "Checking YSong API"}
					</div>
					<Link className="dashboard-primary-link" to="/dashboard/niche-intel">
						Create report
					</Link>
				</div>
			</header>

			<main className="dashboard-content">
				<section className="dashboard-panel exports-intro-panel">
					<div className="dashboard-panel-heading compact">
						<div>
							<span className="dashboard-micro-label">Export center</span>
							<h2>Portable exports from the intelligence already in your YSong workspace.</h2>
						</div>
					</div>
					<p className="panel-note">
						Report exports are generated in the browser from the latest saved analysis. Provider secrets remain on the YSong backend and are never embedded in the export.
					</p>
				</section>

				{report ? (
					<>
						<section className="exports-grid">
							<article className="dashboard-panel export-card">
								<span className="dashboard-micro-label">Full report</span>
								<h2>JSON snapshot</h2>
								<p>Useful for debugging, archiving, comparisons, or feeding a richer dashboard later.</p>
								<button onClick={() => downloadTextFile(`${stem}.json`, JSON.stringify(report, null, 2), "application/json")} type="button">
									Download JSON
								</button>
							</article>

							<article className="dashboard-panel export-card">
								<span className="dashboard-micro-label">Keyword lane</span>
								<h2>Probe CSV</h2>
								<p>Export the follow-up search table for quick spreadsheet sorting or note-taking.</p>
								<button onClick={() => downloadTextFile(`${stem}-keyword-probes.csv`, buildKeywordCsv(report), "text/csv")} type="button">
									Download keyword CSV
								</button>
							</article>

							<article className="dashboard-panel export-card">
								<span className="dashboard-micro-label">Provider lane</span>
								<h2>Platform CSV</h2>
								<p>Capture the platform-level score summary and provider commentary from the current run.</p>
								<button onClick={() => downloadTextFile(`${stem}-platform-pulse.csv`, buildPlatformCsv(report), "text/csv")} type="button">
									Download platform CSV
								</button>
							</article>

							<article className="dashboard-panel export-card">
								<span className="dashboard-micro-label">Readable brief</span>
								<h2>TXT summary</h2>
								<p>A plain-English intelligence memo you can keep, paste, or compare later.</p>
								<button onClick={() => downloadTextFile(`${stem}-summary.txt`, buildPlainTextSummary(report), "text/plain")} type="button">
									Download text summary
								</button>
							</article>
						</section>

						<section className="dashboard-panel export-current-report-panel">
							<div className="dashboard-panel-heading compact">
								<div>
									<span className="dashboard-micro-label">Current export target</span>
									<h2>{report.query}</h2>
								</div>
							</div>

							<div className="export-report-summary">
								<strong>{report.verdict.grade}</strong>
								<div>
									<h3>{report.verdict.label}</h3>
									<p>{report.verdict.summary}</p>
								</div>
							</div>
						</section>
					</>
				) : (
					<section className="dashboard-empty-report-grid">
						<article className="dashboard-panel dashboard-empty-report-card">
							<span className="dashboard-micro-label">Nothing to export yet</span>
							<h2>Generate one report first.</h2>
							<p>
								The export center is live, but it only packages data that already exists in your private YSong session.
							</p>
						</article>
						<article className="dashboard-panel dashboard-empty-state">
							<strong>Exports unlock automatically.</strong>
							<p>Run a niche probe, then come back here to download JSON, CSV, and a readable text memo.</p>
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

export default ExportsPage;
