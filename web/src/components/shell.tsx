import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Activity, FlaskConical, GitCompare, History, Menu, Settings, Shield } from "lucide-react";
import { useState } from "react";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

const GLOBAL = [
  { to: "/", label: "Dashboard", icon: Activity },
  { to: "/analyze", label: "New analysis", icon: FlaskConical },
  { to: "/history", label: "History", icon: History },
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/methodology", label: "Methodology", icon: Shield },
  { to: "/settings", label: "Settings", icon: Settings },
];

const REPORT = [
  ["Overview", ""],
  ["Timeline", "/timeline"],
  ["Buyers", "/buyers"],
  ["Sellers", "/sellers"],
  ["Wallets", "/wallets"],
  ["WETH flows", "/flows"],
  ["Liquidity", "/liquidity"],
  ["Chart", "/chart"],
  ["Security", "/security"],
  ["Diagnosis", "/diagnosis"],
  ["Recommendations", "/recommendations"],
  ["Team", "/team"],
];

export function Shell() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { timeZone, setTimeZone } = useUi();
  const report = location.pathname.match(/^\/reports\/([^/]+)/);
  const base = report ? `/reports/${report[1]}` : "";
  const links = report ? REPORT.map(([label, path]) => ({ to: `${base}${path}`, label, end: path === "" })) : GLOBAL.map((item) => ({ to: item.to, label: item.label, end: item.to === "/" }));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className={cn("border-b border-border bg-[#080d18]/95 md:border-b-0 md:border-r", open ? "block" : "hidden md:block")}>
        <div className="px-4 py-5">
          <NavLink to="/" className="text-lg font-semibold tracking-tight">LaunchForensics</NavLink>
          <p className="mt-1 text-xs text-muted-foreground">Ethereum launch investigation</p>
        </div>
        <nav className="flex gap-1 overflow-auto px-2 pb-4 md:block md:space-y-1">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} onClick={() => setOpen(false)} className={({ isActive }) => cn("block rounded-md px-3 py-2 text-sm text-muted-foreground", isActive && "bg-cyan-400/10 text-cyan-200")}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <button className="rounded-md border border-border p-2 md:hidden" onClick={() => setOpen((value) => !value)} aria-label="Open navigation"><Menu className="h-4 w-4" /></button>
          <div className="text-sm text-muted-foreground">Evidence from Ethereum logs. USD figures are estimates.</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Timezone
            <select className="rounded-md border border-border bg-transparent px-2 py-1 text-foreground" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
              {["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Asia/Tokyo"].map((zone) => <option key={zone}>{zone}</option>)}
              {!["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Asia/Tokyo"].includes(timeZone) ? <option>{timeZone}</option> : null}
            </select>
          </label>
        </header>
        <main className="px-4 py-5 md:px-6"><Outlet /></main>
      </div>
    </div>
  );
}
