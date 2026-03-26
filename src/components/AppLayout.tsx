import { Outlet } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import { useImpersonation } from "@/contexts/ImpersonationContext";

export default function AppLayout() {
  const { impersonating, stopImpersonation } = useImpersonation();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      {impersonating && (
        <div className="sticky top-14 z-40 flex items-center justify-between bg-amber-500 px-4 py-1.5 text-xs text-white">
          <span>
            Viewing as <strong>{impersonating.email}</strong>
            {" — "}
            {impersonating.isAdmin ? "Admin" : "Non-admin"} view
          </span>
          <button
            onClick={stopImpersonation}
            className="rounded bg-white/20 px-2 py-0.5 font-medium transition-colors hover:bg-white/30"
          >
            Exit impersonation
          </button>
        </div>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
