/* eslint-disable react-refresh/only-export-components */
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { fetchApiHealth, fetchNicheIntel } from "../api/musicIntelClient";
import type { ApiHealth, NicheIntelReport, ProviderHealth, ProviderStatus } from "../types/musicIntel";

const RECENT_SEARCHES_KEY = "ysong.tools.seo.recent-searches";
const LAST_QUERY_KEY = "ysong.tools.seo.last-query";
const LAST_REPORT_KEY = "ysong.tools.seo.last-report";
const MAX_RECENT_SEARCHES = 8;

export type DashboardApiState = "checking" | "online" | "offline";

export type DashboardWorkspaceContextValue = {
	query: string;
	setQuery: (value: string) => void;
	report: NicheIntelReport | null;
	recentSearches: string[];
	hasUserSearched: boolean;
	isAnalyzing: boolean;
	analysisError: string | null;
	health: ApiHealth | null;
	apiState: DashboardApiState;
	configuredProviderCount: number;
	providerStatusCards: ProviderStatus[];
	runAnalysis: (nextQuery: string) => Promise<NicheIntelReport | null>;
	clearWorkspaceReport: () => void;
};

const DashboardWorkspaceContext = createContext<DashboardWorkspaceContextValue | null>(null);

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

function safeReadRecentSearches(): string[] {
	const parsedValue = safeReadStorageValue<unknown>(RECENT_SEARCHES_KEY, []);
	if (!Array.isArray(parsedValue)) {
		return [];
	}

	return parsedValue.filter((value): value is string => typeof value === "string").slice(0, MAX_RECENT_SEARCHES);
}

function safeReadLastQuery(): string {
	const parsedValue = safeReadStorageValue<unknown>(LAST_QUERY_KEY, "");
	return typeof parsedValue === "string" ? parsedValue : "";
}

function safeReadLastReport(): NicheIntelReport | null {
	const parsedValue = safeReadStorageValue<unknown>(LAST_REPORT_KEY, null);
	if (!parsedValue || typeof parsedValue !== "object") {
		return null;
	}

	return parsedValue as NicheIntelReport;
}

function writeStorageValue(key: string, value: unknown): void {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// The app can still work when localStorage is blocked or unavailable.
	}
}

function removeStorageValue(key: string): void {
	try {
		window.localStorage.removeItem(key);
	} catch {
		// No-op: inability to clear storage should not break the UI.
	}
}

function toStatusCards(health: ProviderHealth[] | undefined, report: NicheIntelReport | null): ProviderStatus[] {
	if (report) {
		return report.meta.providerStatuses;
	}

	return (health || []).map((provider) => ({
		platform: provider.platform,
		state: provider.configured || provider.platform === "iTunes" ? "live" : "not-configured",
		label: provider.label,
		detail: provider.detail,
	}));
}

export function DashboardWorkspaceProvider({ children }: { children: ReactNode }) {
	const [query, setQuery] = useState<string>(() => safeReadLastQuery());
	const [report, setReport] = useState<NicheIntelReport | null>(() => safeReadLastReport());
	const [recentSearches, setRecentSearches] = useState<string[]>(() => safeReadRecentSearches());
	const [hasUserSearched, setHasUserSearched] = useState<boolean>(() => Boolean(safeReadLastReport()));
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [analysisError, setAnalysisError] = useState<string | null>(null);
	const [health, setHealth] = useState<ApiHealth | null>(null);
	const [apiState, setApiState] = useState<DashboardApiState>("checking");

	useEffect(() => {
		writeStorageValue(RECENT_SEARCHES_KEY, recentSearches);
	}, [recentSearches]);

	useEffect(() => {
		if (query) {
			writeStorageValue(LAST_QUERY_KEY, query);
			return;
		}

		removeStorageValue(LAST_QUERY_KEY);
	}, [query]);

	useEffect(() => {
		if (report) {
			writeStorageValue(LAST_REPORT_KEY, report);
			return;
		}

		removeStorageValue(LAST_REPORT_KEY);
	}, [report]);

	useEffect(() => {
		let active = true;

		fetchApiHealth()
			.then((payload) => {
				if (!active) {
					return;
				}

				setHealth(payload);
				setApiState("online");
			})
			.catch(() => {
				if (!active) {
					return;
				}

				setApiState("offline");
			});

		return () => {
			active = false;
		};
	}, []);

	const runAnalysis = useCallback(
		async (nextQuery: string): Promise<NicheIntelReport | null> => {
			const cleanedQuery = nextQuery.trim().replace(/\s+/g, " ");
			if (!cleanedQuery || isAnalyzing) {
				return null;
			}

			setQuery(cleanedQuery);
			setAnalysisError(null);
			setIsAnalyzing(true);

			try {
				const nextReport = await fetchNicheIntel(cleanedQuery);
				setReport(nextReport);
				setHasUserSearched(true);
				setRecentSearches((previousSearches) => {
					const dedupedSearches = previousSearches.filter(
						(search) => search.toLowerCase() !== cleanedQuery.toLowerCase(),
					);
					return [cleanedQuery, ...dedupedSearches].slice(0, MAX_RECENT_SEARCHES);
				});
				return nextReport;
			} catch (error) {
				const message = error instanceof Error ? error.message : "The YSong SEO analysis request failed.";
				setAnalysisError(message);
				return null;
			} finally {
				setIsAnalyzing(false);
			}
		},
		[isAnalyzing],
	);

	const clearWorkspaceReport = useCallback(() => {
		setQuery("");
		setReport(null);
		setHasUserSearched(false);
		setAnalysisError(null);
	}, []);

	const configuredProviderCount =
		health?.providers.filter((provider) => provider.configured || provider.platform === "iTunes").length ?? 0;
	const providerStatusCards = useMemo(() => toStatusCards(health?.providers, report), [health?.providers, report]);

	const value = useMemo<DashboardWorkspaceContextValue>(
		() => ({
			query,
			setQuery,
			report,
			recentSearches,
			hasUserSearched,
			isAnalyzing,
			analysisError,
			health,
			apiState,
			configuredProviderCount,
			providerStatusCards,
			runAnalysis,
			clearWorkspaceReport,
		}),
		[
			analysisError,
			apiState,
			clearWorkspaceReport,
			configuredProviderCount,
			hasUserSearched,
			health,
			isAnalyzing,
			providerStatusCards,
			query,
			recentSearches,
			report,
			runAnalysis,
		],
	);

	return <DashboardWorkspaceContext.Provider value={value}>{children}</DashboardWorkspaceContext.Provider>;
}

export function useDashboardWorkspace(): DashboardWorkspaceContextValue {
	const context = useContext(DashboardWorkspaceContext);
	if (!context) {
		throw new Error("useDashboardWorkspace must be used inside DashboardWorkspaceProvider.");
	}

	return context;
}
