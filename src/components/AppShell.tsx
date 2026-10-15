import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setSelection } from "@/lib/tenant";
import { Button } from "@/components/ui/button";

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await qc.cancelQueries();
    qc.clear();
    setSelection(null);
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
}

export function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(navigator.onLine);
    const u = () => setOn(true), d = () => setOn(false);
    window.addEventListener("online", u); window.addEventListener("offline", d);
    return () => { window.removeEventListener("online", u); window.removeEventListener("offline", d); };
  }, []);
  return on;
}

const NAV = [
  { to: "/home", label: "Home" },
  { to: "/pos", label: "Till" },
  { to: "/shift", label: "Shift" },
  { to: "/catalog", label: "Products" },
  { to: "/inventory", label: "Stock" },
  { to: "/sales", label: "Sales" },
  { to: "/customers", label: "Deni" },
  { to: "/mpesa", label: "M-Pesa" },
  { to: "/dashboard", label: "Reports" },
  { to: "/staff", label: "Staff" },
] as const;

export function AppShell({ children, right, wide }: { children: ReactNode; right?: ReactNode; wide?: boolean }) {
  const signOut = useSignOut();
  const online = useOnline();
  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-4 border-foreground bg-primary px-4 py-3 text-primary-foreground">
        <span className="text-xl font-black tracking-tight">RONIA</span>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm font-black ${online ? "bg-secondary text-secondary-foreground" : "bg-destructive text-destructive-foreground"}`}>
            {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}{online ? "Online" : "Offline"}
          </span>
          {right}
          <Button variant="secondary" size="lg" onClick={signOut} className="font-bold">
            <LogOut /> Sign out
          </Button>
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b-2 border-foreground bg-card px-2 py-2">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className="shrink-0 rounded-md px-4 py-2 text-base font-black" activeProps={{ className: "bg-foreground text-background" }}>
            {n.label}
          </Link>
        ))}
      </nav>
      <main className={`mx-auto w-full p-4 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>{children}</main>
    </div>
  );
}
