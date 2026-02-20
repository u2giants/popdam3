import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Library, Settings, Download, LogOut, User, Cpu, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Library", icon: Library },
  { to: "/setup", label: "Setup", icon: Wand2 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/downloads", label: "Downloads", icon: Download },
];

const statusColor: Record<string, string> = {
  online: "bg-success",
  degraded: "bg-warning",
  offline: "bg-destructive",
  none: "bg-muted-foreground/40",
};

const statusLabel: Record<string, string> = {
  online: "Agents online",
  degraded: "Some agents offline",
  offline: "All agents offline",
  none: "No agents registered",
};

export default function AppHeader() {
  const { user, signOut } = useAuth();
  const agent = useAgentStatus();

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

      {/* Right: Agent status + User menu */}
      <div className="flex items-center gap-3">
        {/* Agent status indicator */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={statusLabel[agent.status]}>
          <Cpu className="h-3.5 w-3.5" />
          <span className={cn("h-2 w-2 rounded-full", statusColor[agent.status])} />
          <span className="hidden sm:inline">
            {agent.agentCount === 0 ? "No agents" : `${agent.onlineCount}/${agent.agentCount}`}
          </span>
        </div>

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
