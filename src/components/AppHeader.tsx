import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUserProfile } from "@/hooks/useUserProfile";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useAgentStatus, type AgentRecord } from "@/hooks/useAgentStatus";
import { useAppearance, type Theme, type Accent } from "@/hooks/useAppearance";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Library,
  Settings,
  Download,
  LogOut,
  Wand2,
  RefreshCw,
  Menu,
  Eye,
  EyeOff,
  FolderOpen,
  Layers,
  Sun,
  Moon,
  Bell,
  Database,
  ImageDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format-date";
import { useState } from "react";
import { CURRENT_APP, IS_POPSG } from "@/lib/app-mode";

const popdamNavItems = [
  { to: "/", label: "Library", icon: Library },
  { to: "/files", label: "Files", icon: FolderOpen },
  { to: "/sell-through", label: "Sell-through", icon: ImageDown },
  { href: "https://dam.designflow.app/styles", label: "Master Data", icon: Database },
  { to: "/setup", label: "Setup", icon: Wand2 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/downloads", label: "Downloads", icon: Download },
];

const popsgNavItems = [
  { to: "/library", label: "Library", icon: Library },
  { to: "/files", label: "Files", icon: FolderOpen },
  { to: "/settings", label: "Settings", icon: Settings },
];

const navItems = IS_POPSG ? popsgNavItems : popdamNavItems;

const ACCENT_OPTIONS: { value: Accent; label: string; color: string }[] = [
  { value: "indigo", label: "Indigo", color: "#6366f1" },
  { value: "teal",   label: "Teal",   color: "#14b8a6" },
  { value: "amber",  label: "Amber",  color: "#f59e0b" },
  { value: "rose",   label: "Rose",   color: "#f43f5e" },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function AgentDetail({ agent }: { agent: AgentRecord }) {
  const c = agent.lastCounters;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              agent.isOnline ? "bg-success" : "bg-destructive"
            )}
          />
          <span className="font-medium text-foreground text-xs">{agent.agent_name}</span>
        </div>
        <span className="text-[10px] text-muted-foreground capitalize">{agent.agent_type}</span>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Heartbeat: {timeAgo(agent.last_heartbeat)}
      </div>

      {c && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] pt-1 border-t border-border">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Checked</span>
            <span className="font-mono text-foreground">{c.files_checked.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Candidates</span>
            <span className="font-mono text-foreground">{c.candidates_found.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ingested</span>
            <span className="font-mono font-semibold text-success">{c.ingested_new.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Moved</span>
            <span className="font-mono text-foreground">{c.moved_detected.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Updated</span>
            <span className="font-mono text-foreground">{c.updated_existing.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Errors</span>
            <span
              className={cn(
                "font-mono",
                c.errors > 0 ? "text-destructive font-semibold" : "text-foreground"
              )}
            >
              {c.errors.toLocaleString()}
            </span>
          </div>
          {(c.roots_invalid > 0 || c.roots_unreadable > 0) && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Roots invalid</span>
                <span className="font-mono text-destructive">{c.roots_invalid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Roots unreadable</span>
                <span className="font-mono text-destructive">{c.roots_unreadable}</span>
              </div>
            </>
          )}
          {c.dirs_skipped_permission > 0 && (
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">Dirs skipped (perms)</span>
              <span className="font-mono text-warning">{c.dirs_skipped_permission}</span>
            </div>
          )}
          {(c.dirs_skipped_excluded ?? 0) > 0 && (
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">Dirs skipped (excluded)</span>
              <span className="font-mono">{c.dirs_skipped_excluded}</span>
            </div>
          )}
        </div>
      )}

      {agent.lastError && (
        <div className="text-[10px] text-destructive mt-1 truncate" title={agent.lastError}>
          Error: {agent.lastError}
        </div>
      )}
    </div>
  );
}

function initialsOf(name: string, email: string): string {
  const base = (name && !name.includes("@") ? name : email).replace(/@.*/, "");
  const parts = base.split(/[ ._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------- Sync pill ----------

function SyncPill({ agent }: { agent: ReturnType<typeof useAgentStatus> }) {
  const isOffline = agent.bridgeStatus === "offline" || agent.bridgeStatus === "none";
  const isScanning = !isOffline && agent.agents.some((a) => a.isOnline && a.agent_type === "bridge");

  // Determine label + dot style
  let dotClass = "";
  let label = "";
  let timeLabel = "";

  if (isOffline) {
    dotClass = "bg-destructive";
    label = "Offline";
  } else if (isScanning) {
    dotClass = "bg-amber-400 animate-pulse";
    label = "Syncing…";
  } else {
    dotClass = "bg-green-500";
    label = "Synced";
    // Use latest heartbeat as proxy for last sync time
    const latest = agent.agents
      .filter((a) => a.last_heartbeat)
      .map((a) => a.last_heartbeat as string)
      .sort()
      .at(-1) ?? null;
    timeLabel = timeAgo(latest);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:opacity-80"
          style={{
            background: "var(--pd-surface)",
            border: "1px solid var(--pd-border)",
            color: "var(--pd-fg-muted, var(--muted-foreground))",
          }}
        >
          <span className={cn("h-2 w-2 rounded-full shrink-0", dotClass)} />
          <span>{label}</span>
          {timeLabel && (
            <span className="opacity-60">{timeLabel}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-foreground">Agent Status</p>
          <span className="text-[10px] text-muted-foreground">
            {agent.onlineCount}/{agent.agentCount} online
          </span>
        </div>
        {agent.agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No agents registered.</p>
        ) : (
          <div className="space-y-2">
            {agent.agents.map((a) => (
              <AgentDetail key={a.id} agent={a} />
            ))}
          </div>
        )}
        <div className="mt-3 pt-2 border-t border-border flex items-center justify-between">
          <Link
            to="/setup"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Diagnostics
          </Link>
          <button
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              /* sync-now placeholder — wired in Index.tsx via scan lifecycle */
            }}
          >
            <RefreshCw className="h-3 w-3" />
            Sync now
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Appearance button ----------

function AppearanceButton({
  theme,
  setTheme,
  accent,
  setAccent,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: Accent;
  setAccent: (a: Accent) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Appearance"
        >
          {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-3 space-y-3">
        {/* Theme toggle */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Theme
          </p>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {(["light", "dark"] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors capitalize",
                  theme === t
                    ? "font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                style={
                  theme === t
                    ? {
                        background: "var(--pd-accent-soft)",
                        color: "var(--pd-accent-soft-fg, var(--pd-accent))",
                      }
                    : {}
                }
              >
                {t === "light" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Accent swatches */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Accent
          </p>
          <div className="flex gap-2">
            {ACCENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                title={opt.label}
                onClick={() => setAccent(opt.value)}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-transform hover:scale-110",
                  accent === opt.value ? "border-foreground" : "border-transparent"
                )}
                style={{ background: opt.color }}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Desktop nav ----------

function DesktopNav() {
  const location = useLocation();

  function isNavActive(to: string): boolean {
    if (to === "/" || to === "/library") return location.pathname === to || location.pathname === "/";
    return location.pathname.startsWith(to);
  }

  return (
    <nav className="hidden md:flex items-center gap-0.5 ml-2">
      {navItems.map((item) => {
        const active = "to" in item ? isNavActive(item.to) : false;
        const className = "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors";
        const style = active
          ? {
              background: "var(--pd-accent-soft, var(--accent))",
              color: "var(--pd-accent-soft-fg, var(--accent-foreground))",
              fontWeight: 600,
            }
          : {
              color: "var(--pd-fg-muted, var(--muted-foreground))",
            };

        if ("href" in item) {
          return (
            <a
              key={item.href}
              href={item.href}
              className={className}
              style={style}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </a>
          );
        }

        return (
          <Link
            key={item.to}
            to={item.to}
            className={className}
            style={style}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------- Main component ----------

export default function AppHeader() {
  const { signOut } = useAuth();
  const { name, email, avatarUrl } = useUserProfile();
  const { isRealAdmin } = useIsAdmin();
  const { impersonatedRole, startImpersonating, stopImpersonating } = useImpersonation();
  const agent = useAgentStatus(isRealAdmin);
  const { theme, setTheme, accent, setAccent } = useAppearance();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = initialsOf(name, email);

  return (
    <>
      {/* Impersonation banner */}
      {impersonatedRole && (
        <div className="sticky top-0 z-[51] flex items-center justify-center gap-3 bg-warning/90 px-4 py-1.5 text-warning-foreground text-xs font-medium">
          <Eye className="h-3.5 w-3.5" />
          Viewing as <span className="font-bold capitalize">{impersonatedRole}</span>
          <button
            onClick={stopImpersonating}
            className="ml-1 rounded bg-warning-foreground/20 px-2 py-0.5 text-[11px] font-semibold hover:bg-warning-foreground/30 transition-colors"
          >
            Stop
          </button>
        </div>
      )}

      <header
        className="sticky top-0 z-50 flex h-14 items-center justify-between px-4"
        style={{
          background: "var(--pd-hdr-bg, var(--background))",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--pd-border, var(--border))",
        }}
      >
        {/* ---- Left: brand + nav ---- */}
        <div className="flex items-center gap-4">
          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden h-8 w-8">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-56 p-4 pt-10">
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => {
                  if ("href" in item) {
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => setMobileOpen(false)}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </a>
                    );
                  }

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/" || item.to === "/library"}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      activeClassName="bg-accent text-foreground"
                      onClick={() => setMobileOpen(false)}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>

          {/* Brand lockup */}
          <Link to={IS_POPSG ? "/library" : "/"} className="flex items-center gap-2 shrink-0">
            {/* Brand mark */}
            <span
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] shrink-0"
              style={{
                background:
                  "linear-gradient(140deg, var(--pd-accent, #6366f1), var(--pd-accent-hov, #4f46e5))",
              }}
            >
              <Layers className="h-3.5 w-3.5 text-white" />
            </span>
            {/* Wordmark */}
            <span className="text-[15px] font-semibold tracking-tight text-foreground leading-none select-none">
              {CURRENT_APP.name.startsWith("Pop") ? (
                <>
                  Pop
                  <span style={{ color: "var(--pd-accent, #6366f1)", fontWeight: 700 }}>
                    {CURRENT_APP.name.slice(3)}
                  </span>
                </>
              ) : (
                CURRENT_APP.name
              )}
            </span>
          </Link>

          {/* Desktop nav — hidden below 720px (Tailwind sm = 640px; we use md = 768px) */}
          <DesktopNav />
        </div>

        {/* ---- Right: status + tools + user ---- */}
        <div className="flex items-center" style={{ gap: "8px" }}>
          {/* Build stamp */}
          <span
            className="hidden lg:inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground select-all"
            title="Build info"
          >
            {__APP_COMMIT__} · {formatDateTime(__APP_DATE__)}
          </span>

          {/* Sync status pill */}
          {isRealAdmin && <SyncPill agent={agent} />}

          {/* Appearance button */}
          <AppearanceButton
            theme={theme}
            setTheme={setTheme}
            accent={accent}
            setAccent={setAccent}
          />

          {/* Notifications bell */}
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>

          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[11px] font-semibold shrink-0 transition-opacity hover:opacity-80"
                style={{
                  background: "var(--pd-accent-soft, var(--accent))",
                  color: "var(--pd-accent-soft-fg, var(--accent-foreground))",
                }}
                title={name || email}
              >
                {avatarUrl ? (
                  <Avatar className="h-[30px] w-[30px]">
                    <AvatarImage src={avatarUrl} alt={name} />
                    <AvatarFallback
                      style={{
                        background: "var(--pd-accent-soft, var(--accent))",
                        color: "var(--pd-accent-soft-fg, var(--accent-foreground))",
                        fontSize: "11px",
                        fontWeight: 600,
                      }}
                    >
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  initials
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Avatar className="h-8 w-8">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
                  <AvatarFallback className="bg-primary/15 text-xs font-medium text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">{email}</p>
                </div>
              </div>
              <DropdownMenuSeparator />

              {/* Impersonation controls — only for real admins */}
              {isRealAdmin && !impersonatedRole && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <Eye className="h-4 w-4" />
                    Impersonate
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => startImpersonating("member")}>
                      Member
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {isRealAdmin && impersonatedRole && (
                <DropdownMenuItem onClick={stopImpersonating} className="gap-2 text-warning">
                  <EyeOff className="h-4 w-4" />
                  Stop Impersonating
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={signOut}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  );
}
