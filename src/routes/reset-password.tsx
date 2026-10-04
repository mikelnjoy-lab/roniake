import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — RONIA Business" },
      { name: "description", content: "Choose a new password for your RONIA Business account." },
      { property: "og:title", content: "Set a new password — RONIA Business" },
      { property: "og:description", content: "Choose a new password for your RONIA Business account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    navigate({ to: "/select", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b-4 border-foreground bg-primary px-6 py-8 text-primary-foreground">
        <h1 className="text-4xl font-black">New password</h1>
      </div>
      <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-4 p-6">
        <Input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className="h-14 border-2 text-lg" />
        <Button type="submit" disabled={busy} size="lg" className="h-16 text-xl font-black">Save password</Button>
      </form>
    </div>
  );
}
