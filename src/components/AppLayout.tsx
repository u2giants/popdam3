import { Outlet } from "react-router-dom";
import AppHeader from "@/components/AppHeader";

export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
