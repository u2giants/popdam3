import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useAgentStatus, type AgentRecord } from "@/hooks/useAgentStatus";
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
import { Library, Settings, Download, LogOut, User, Wand2, RefreshCw, Menu, Eye, EyeOff, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format-date";
import { useState } from "react";
import { CURRENT_APP, IS_POPSG } from "@/lib/app-mode";

const popdamNavItems = [
  { to: "/", label: "Library", icon: Library },
  { to: "/files", label: "Files", icon: FolderOpen },
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

const dotColor: Record<string, string> = {
  online: "bg-success",
  offline: "bg-destructive",
  none: "bg-muted-foreground/40",
};

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
          <span className={cn("h-2 w-2 rounded-full shrink-0", agent.isOnline ? "bg-success" : "bg-destructive")} />
          <span className="font-medium text-foreground text-xs">{agent.agent_name}</span>
        </div>
        <span className="text-[10px] text-muted-foreground capitalize">{agent.agent_type}</span>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Heartbeat: {timeAgo(agent.last_heartbeat)}
      </div>

      {/* Scan status is now driven by useScanProgress in Index.tsx, not agent metadata */}

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
            <span className="font-mono text-foreground font-semibold text-success">{c.ingested_new.toLocaleString()}</span>
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
            <span className={cn("font-mono", c.errors > 0 ? "text-destructive font-semibold" : "text-foreground")}>{c.errors.toLocaleString()}</span>
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

export default function AppHeader() {
  const { user, signOut } = useAuth();
  const { isRealAdmin } = useIsAdmin();
  const { impersonatedRole, startImpersonating, stopImpersonating } = useImpersonation();
  const agent = useAgentStatus();
  const [mobileOpen, setMobileOpen] = useState(false);

  const bridgeLabel = agent.bridgeStatus === "online"
    ? "Synology"
    : agent.bridgeStatus === "offline"
    ? "Offline"
    : "No agent";

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

      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-surface-overlay px-4">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-4 md:gap-6">
          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden h-8 w-8">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-56 p-4 pt-10">
              <nav className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    activeClassName="bg-accent text-foreground"
                    onClick={() => setMobileOpen(false)}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </SheetContent>
          </Sheet>

          <Link to="/library" className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-primary">{CURRENT_APP.name}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                activeClassName="bg-accent text-foreground"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Right: Agent status + User menu */}
        <div className="flex items-center gap-3">
          {/* Build stamp */}
          <span className="hidden lg:inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground select-all" title="Build info">
            {__APP_COMMIT__} · {formatDateTime(__APP_DATE__)}
          </span>

          {/* Bridge agent status */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                title={agent.bridgeStatus === "online" ? "Synology connected" : agent.bridgeStatus === "offline" ? "Synology offline" : "No bridge agent"}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", dotColor[agent.bridgeStatus])} />
                <span className="hidden sm:inline">{bridgeLabel}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-foreground">Agent Status</p>
                <span className="text-[10px] text-muted-foreground">
                  {agent.onlineCount}/{agent.agentCount} online
                </span>
              </div>
              {agent.agents.length === 0 && (
                <p className="text-xs text-muted-foreground">No agents registered.</p>
              )}
              <div className="space-y-2">
                {agent.agents.map((a) => (
                  <AgentDetail key={a.id} agent={a} />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span className="hidden max-w-[140px] truncate sm:inline">
                  {user?.email ?? "User"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="text-xs text-muted-foreground" disabled>
                {user?.email}
              </DropdownMenuItem>
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
              <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
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
