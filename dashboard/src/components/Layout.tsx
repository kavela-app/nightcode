import { NavLink, Outlet } from "react-router-dom";
import StatusAlert from "./StatusAlert";

const navItems = [
  { to: "/", label: "Dashboard", icon: "~" },
  { to: "/tasks", label: "Tasks", icon: ">" },
  { to: "/repos", label: "Repos", icon: "#" },
  { to: "/agent", label: "Agent", icon: "%" },
  { to: "/schedules", label: "Schedules", icon: "@" },
  { to: "/settings", label: "Settings", icon: "*" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <StatusAlert />
      <div className="flex flex-1">
      {/* Sidebar */}
      <nav className="w-56 bg-zinc-900 border-r border-zinc-800 flex flex-col p-4 shrink-0">
        <div className="mb-8">
          <h1 className="text-lg font-bold text-white tracking-tight">
            nightcode
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            code ships while you dream
          </p>
        </div>

        <ul className="space-y-1 flex-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  }`
                }
              >
                <span className="font-mono text-xs w-4 text-center opacity-50">
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-600">v0.1.0</p>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
      </div>
    </div>
  );
}
