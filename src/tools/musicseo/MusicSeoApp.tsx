import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import DashboardLayout from "./dashboard/DashboardLayout";
import ExportsPage from "./dashboard/pages/ExportsPage";
import GenreRadarPage from "./dashboard/pages/GenreRadarPage";
import KeywordIntelPage from "./dashboard/pages/KeywordIntelPage";
import MlLabPage from "./dashboard/pages/MlLabPage";
import NicheIntelPage from "./dashboard/pages/NicheIntelPage";
import OverviewPage from "./dashboard/pages/OverviewPage";
import PlatformAnalyticsPage from "./dashboard/pages/PlatformAnalyticsPage";

export default function MusicSeoApp({ onBack }: { onBack: () => void }) {
  return (
    <div className="ysong-seo-root h-full min-h-0 overflow-hidden bg-neutral-950 text-neutral-100">
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout onBack={onBack} />}>
            <Route index element={<OverviewPage />} />
            <Route path="genre-radar" element={<GenreRadarPage />} />
            <Route path="keyword-intel" element={<KeywordIntelPage />} />
            <Route path="ml-lab" element={<MlLabPage />} />
            <Route path="platform-analytics" element={<PlatformAnalyticsPage />} />
            <Route path="niche-intel" element={<NicheIntelPage />} />
            <Route path="exports" element={<ExportsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </MemoryRouter>
    </div>
  );
}
