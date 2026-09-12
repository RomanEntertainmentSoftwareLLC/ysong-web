/* eslint-disable react-refresh/only-export-components */
import type { ProviderHighlight, ScoreSet, TrendPoint } from "../types/musicIntel";

export type ScoreRow = {
	label: string;
	value: number;
	description: string;
};

export function getScoreRows(scores: ScoreSet): ScoreRow[] {
	return [
		{
			label: "Demand",
			value: scores.demand,
			description: "Heuristic blend of live provider result-surface signals.",
		},
		{
			label: "Momentum",
			value: scores.momentum,
			description: "Heuristic blend of recency and sampled velocity signals where providers expose them.",
		},
		{
			label: "Competition",
			value: scores.competition,
			description: "Higher means the live provider surface looks more crowded or heavily populated.",
		},
		{
			label: "Opportunity",
			value: scores.opportunity,
			description: "Composite score after competition is treated as a penalty, not a prize.",
		},
	];
}

export function formatGeneratedAt(value: string): string {
	const parsedDate = new Date(value);
	if (Number.isNaN(parsedDate.getTime())) {
		return "Just now";
	}

	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(parsedDate);
}

export function buildTrendPolyline(points: TrendPoint[]): string {
	if (points.length === 0) {
		return "";
	}

	return points
		.map((point, index) => {
			const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
			const y = 100 - point.value;
			return `${x},${y}`;
		})
		.join(" ");
}

export function buildTrendArea(points: TrendPoint[]): string {
	const polyline = buildTrendPolyline(points);
	if (!polyline) {
		return "";
	}

	return `0,100 ${polyline} 100,100`;
}

export function groupHighlightsByPlatform(highlights: ProviderHighlight[]): Record<string, ProviderHighlight[]> {
	return highlights.reduce<Record<string, ProviderHighlight[]>>((groups, highlight) => {
		const key = highlight.platform;
		groups[key] = [...(groups[key] || []), highlight];
		return groups;
	}, {});
}

export function ScoreGauge({ score, label }: { score: number; label: string }) {
	const radius = 48;
	const circumference = 2 * Math.PI * radius;
	const strokeDashoffset = circumference - (score / 100) * circumference;

	return (
		<div className="score-gauge" aria-label={`${label}: ${score} out of 100`}>
			<svg viewBox="0 0 120 120" role="img" aria-hidden="true">
				<circle className="score-gauge-track" cx="60" cy="60" r={radius} />
				<circle
					className="score-gauge-progress"
					cx="60"
					cy="60"
					r={radius}
					strokeDasharray={circumference}
					strokeDashoffset={strokeDashoffset}
				/>
			</svg>

			<div className="score-gauge-copy">
				<strong>{score}</strong>
				<span>/100</span>
			</div>
		</div>
	);
}
