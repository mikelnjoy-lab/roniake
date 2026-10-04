import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
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

export function AppShell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const signOut = useSignOut();
  useRouter();
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between gap-2 border-b-4 border-foreground bg-primary px-4 py-3 text-primary-foreground">
        <span className="text-xl font-black tracking-tight">RONIA</span>
        <div className="flex items-center gap-2">
          {right}
          <Button variant="secondary" size="lg" onClick={signOut} className="font-bold">
            <LogOut /> Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl p-4">{children}</main>
    </div>
  );
}
