export type ScoreSet = {
	demand: number;
	momentum: number;
	competition: number;
	opportunity: number;
};

export type VerdictTone = "strong" | "promising" | "watch" | "weak";

export type Verdict = {
	grade: "A" | "B" | "C" | "D";
	label: string;
	tone: VerdictTone;
	summary: string;
};

export type TrendPoint = {
	label: string;
	value: number;
};

export type ProviderKey = "Spotify" | "YouTube" | "iTunes";
export type ProviderState = "live" | "not-configured" | "error";


export type KeywordEvidence = {
	platform: ProviderKey;
	source: "tag" | "title" | "album" | "genre" | "description";
	text: string;
	weight: number;
};

export type ObservedKeyword = {
	phrase: string;
	kind: "term" | "phrase" | "tag";
	mentions: number;
	weightedScore: number;
	providers: ProviderKey[];
	sourceCounts: Array<{ platform: ProviderKey; mentions: number }>;
};

export type PlatformSignal = {
	platform: ProviderKey;
	score: number;
	status: string;
	insight: string;
};

export type KeywordIdea = {
	term: string;
	angle: "Core" | "Long-tail" | "Adjacent" | "Discovery";
	momentum: number;
	competition: "Low" | "Medium" | "High";
};

export type ProviderStatus = {
	platform: ProviderKey;
	state: ProviderState;
	label: string;
	detail: string;
	resultCount?: number;
};

export type ProviderHighlight = {
	platform: ProviderKey;
	title: string;
	subtitle: string;
	metricLabel: string;
	metricValue: string;
	url?: string;
};

export type NicheIntelReport = {
	query: string;
	scores: ScoreSet;
	verdict: Verdict;
	trend: TrendPoint[];
	platformSignals: PlatformSignal[];
	keywordIdeas: KeywordIdea[];
	reasons: string[];
	highlights: ProviderHighlight[];
	observedKeywords?: ObservedKeyword[];
	meta: {
		dataMode: "live-partial" | "live-full";
		generatedAt: string;
		providerStatuses: ProviderStatus[];
		sourceSummary: string;
	};
};

export type ProviderHealth = {
	platform: ProviderKey;
	configured: boolean;
	label: string;
	detail: string;
};

export type ApiHealth = {
	status: "ok";
	service: string;
	port: number;
	providers: ProviderHealth[];
};

export type GenreRadarUniverseKey = "starter" | "expanded" | "atlas";
export type GenreRadarCacheState = "fresh" | "cache-hit";

export type GenreRadarEntry = {
	genre: string;
	category: string;
	marketHeat: number;
	opportunity: number;
	demand: number;
	momentum: number;
	competition: number;
	supply: number;
	opportunityGap: number;
	providersLive: number;
	providerSummary: string;
};

export type GenreRadarLeaderboard = {
	metric: "marketHeat" | "opportunity" | "opportunityGap";
	label: string;
	description: string;
	entries: GenreRadarEntry[];
};

export type GenreRadarScanPlan = {
	mode: "quick-live-pool" | "atlas-two-stage";
	dictionaryCount: number;
	refinedCount: number;
	coarseProvider: string;
	refineProvider: string;
};

export type GenreRadarReport = {
	universe: {
		key: GenreRadarUniverseKey;
		label: string;
		description: string;
		candidateCount: number;
	};
	generatedAt: string;
	topCount: 10 | 20;
	scannedCount: number;
	cacheState: GenreRadarCacheState;
	providerSummary: string;
	leaderboards: {
		marketHeat: GenreRadarLeaderboard;
		opportunity: GenreRadarLeaderboard;
		opportunityGap?: GenreRadarLeaderboard;
	};
	insights?: {
		dailyTarget: (GenreRadarEntry & { targetScore?: number }) | null;
		avoidToday: (GenreRadarEntry & { crowdingWarning?: number }) | null;
		lowHangingFruit: GenreRadarEntry[];
		scanSummary: string[];
	};
	notes: string[];
	scanPlan?: GenreRadarScanPlan;
};

export type GenreCatalogEntry = {
	genre: string;
	category: string;
	source: "Spotify / Every Noise atlas" | "Local watchlist";
};

export type GenreCatalogResponse = {
	query: string;
	totalGenres: number;
	matchCount: number;
	entries: GenreCatalogEntry[];
};

export type GenreAtlasStats = {
	totalGenres: number;
	spotifyAtlasGenres: number;
	localWatchlistAdditions: number;
};

export type GenreAtlasScanStage =
	| "queued"
	| "apple-coarse"
	| "youtube-refine"
	| "finalizing"
	| "completed"
	| "failed";

export type GenreAtlasScanState = "running" | "completed" | "failed";

export type GenreAtlasScanJob = {
	id: string;
	state: GenreAtlasScanState;
	stage: GenreAtlasScanStage;
	stageLabel: string;
	createdAt: string;
	updatedAt: string;
	topCount: 10 | 20;
	refineCount: number;
	progress: {
		completed: number;
		total: number;
		percent: number;
		currentGenre: string;
	};
	report?: GenreRadarReport;
	error?: string;
};

export type ReleaseOutcome = {
	id: string;
	createdAt: string;
	updatedAt: string;
	title: string;
	genre: string;
	platform: string;
	releaseDate: string;
	demand: number;
	supply: number;
	momentum: number;
	competition: number;
	opportunityGap: number;
	views24h: number;
	views7d: number;
	views30d: number;
	streams30d: number;
	revenue30d: number;
	notes: string;
};

export type ReleaseOutcomeInput = Omit<ReleaseOutcome, "id" | "createdAt" | "updatedAt">;

export type MlStatus = {
	engine: string;
	fastApiPort: number;
	localData: {
		outcomes: number;
		usableOutcomes: number;
		scanSnapshots: number;
	};
	model: {
		trained: boolean;
		trainedAt: string | null;
		algorithm: string;
		modelPath: string;
	};
	confidence: "low" | "early" | "medium";
	recommendation: string;
};

export type MlPrediction = {
	genre: string;
	predictedPerformance: number;
	confidence: "low" | "early" | "medium";
	modelMode: "rules-until-training-data" | "ml-ready-fallback" | string;
	trainingRows: number;
	drivers: Array<{ feature: string; impact: number }>;
	note: string;
};
