import { NavLink, Outlet } from "react-router";
import { DashboardWorkspaceProvider, useDashboardWorkspace } from "./DashboardWorkspaceContext";
import "./Dashboard.css";

const navigationItems = [
  { to: "/dashboard", icon: "⌂", label: "Overview", end: true },
  { to: "/dashboard/genre-radar", icon: "≋", label: "Genre Radar" },
  { to: "/dashboard/keyword-intel", icon: "⌕", label: "Keyword Intel" },
  { to: "/dashboard/ml-lab", icon: "⌬", label: "ML Lab" },
  { to: "/dashboard/platform-analytics", icon: "◉", label: "Platform Analytics" },
  { to: "/dashboard/niche-intel", icon: "◆", label: "Niche Intel" },
  { to: "/dashboard/exports", icon: "⇩", label: "Exports" },
];

function DashboardShell({ onBack }: { onBack: () => void }) {
  const { apiState, health, report } = useDashboardWorkspace();
  const liveProviderCount = report
    ? report.meta.providerStatuses.filter((provider) => provider.state === "live").length
    : health?.providers.filter((provider) => provider.configured || provider.platform === "iTunes").length ?? 0;

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <button className="dashboard-brand" type="button" onClick={onBack} title="Back to YSong Tools">
          <div className="dashboard-brand-mark"><span /></div>
          <div>
            <strong>YSong SEO Intelligence</strong>
            <small>Music market intelligence</small>
          </div>
        </button>

        <nav className="dashboard-nav" aria-label="SEO Intelligence navigation">
          {navigationItems.map((item) => (
            <NavLink
              className={({ isActive }) => `dashboard-nav-item${isActive ? " dashboard-nav-item-active" : ""}`}
              end={item.end}
              key={item.to}
              to={item.to}
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-local-card">
          <span className="sidebar-local-pill">
            {apiState === "online" ? "YSong provider service" : "Provider service"}
          </span>
          <strong>
            {apiState === "online" ? `${liveProviderCount} provider lane${liveProviderCount === 1 ? "" : "s"} ready` : apiState === "offline" ? "Service offline" : "Checking service"}
          </strong>
          <p>
            {apiState === "online"
              ? "Provider credentials stay on the YSong server. The browser never receives YouTube or Spotify secrets."
              : apiState === "offline"
                ? "The SEO workspace is loaded, but the YSong API is not reachable yet. Start the Auth API and try again."
                : "YSong is checking its managed music-intelligence providers."}
          </p>
        </div>

        <button className="sidebar-home-link" type="button" onClick={onBack}>← Back to Tools</button>
      </aside>

      <section className="dashboard-main"><Outlet /></section>
    </div>
  );
}

export default function DashboardLayout({ onBack }: { onBack: () => void }) {
  return (
    <DashboardWorkspaceProvider>
      <DashboardShell onBack={onBack} />
    </DashboardWorkspaceProvider>
  );
}
