import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAgentStatus, type AgentRecord } from "@/hooks/useAgentStatus";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Library, Settings, Download, LogOut, User, Wand2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Library", icon: Library },
  { to: "/setup", label: "Setup", icon: Wand2 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/downloads", label: "Downloads", icon: Download },
];

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

      {agent.scanRequested && !agent.scanAbort && (
        <div className="flex items-center gap-1 text-[10px] text-primary font-medium">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Scan running
        </div>
      )}
      {agent.scanAbort && (
        <div className="text-[10px] text-warning font-medium">Scan abort requested</div>
      )}

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
  const agent = useAgentStatus();

  const bridgeLabel = agent.bridgeStatus === "online"
    ? "Synology"
    : agent.bridgeStatus === "offline"
    ? "Offline"
    : "No agent";

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-surface-overlay px-4">
      {/* Left: Logo + Nav */}
      <div className="flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-primary">PopDAM</span>
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

      {/* Right: Scan indicator + Agent status + User menu */}
      <div className="flex items-center gap-3">
        {/* Scan running indicator */}
        {agent.scanRunning && (
          <div className="flex items-center gap-1.5 text-xs text-primary font-medium animate-pulse">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            <span className="hidden sm:inline">Scanning…</span>
          </div>
        )}

        {/* Bridge agent status — click for full agent list */}
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
            <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
