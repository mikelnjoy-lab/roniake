import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — RONIA Business" },
      { name: "description", content: "Sign in to your RONIA Business till and back office." },
      { property: "og:title", content: "Sign in — RONIA Business" },
      { property: "og:description", content: "Sign in to your RONIA Business till and back office." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/select", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === "SIGNED_IN" && s) navigate({ to: "/select", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/select", data: { display_name: name } },
        });
        if (error) throw error;
        setNotice("Check your email and tap the link to confirm your account.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        setNotice("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (res?.error) toast.error(String(res.error.message ?? res.error));
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password";

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b-4 border-foreground bg-primary px-6 py-8 text-primary-foreground">
        <p className="text-sm font-bold uppercase tracking-widest">RONIA Business</p>
        <h1 className="mt-2 text-4xl font-black">{title}</h1>
      </div>
      <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-4 p-6">
        {mode === "signup" && (
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required className="h-14 border-2 text-lg" />
          </Field>
        )}
        <Field label="Email">
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-14 border-2 text-lg" />
        </Field>
        {mode !== "forgot" && (
          <Field label="Password">
            <Input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-14 border-2 text-lg"
            />
          </Field>
        )}
        {notice && <p className="rounded-lg border-2 border-foreground bg-secondary p-3 font-semibold">{notice}</p>}
        <Button type="submit" disabled={busy} size="lg" className="h-16 text-xl font-black">
          {busy ? "Please wait…" : title}
        </Button>
        {mode !== "forgot" && (
          <Button type="button" variant="outline" size="lg" onClick={google} className="h-14 border-2 text-lg font-bold">
            Continue with Google
          </Button>
        )}
        <div className="flex flex-col gap-2 pt-2 text-center font-semibold">
          {mode !== "signin" && <button type="button" className="underline" onClick={() => setMode("signin")}>I already have an account</button>}
          {mode !== "signup" && <button type="button" className="underline" onClick={() => setMode("signup")}>Create a new account</button>}
          {mode === "signin" && <button type="button" className="underline" onClick={() => setMode("forgot")}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-base font-bold">{label}</Label>
      {children}
    </div>
  );
}
