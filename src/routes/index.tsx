import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RONIA Business — POS for Kenyan shops" },
      { name: "description", content: "Fast, offline-ready point of sale and back office for Kenyan retailers." },
      { property: "og:title", content: "RONIA Business — POS for Kenyan shops" },
      { property: "og:description", content: "Fast, offline-ready point of sale and back office for Kenyan retailers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex-1 border-b-4 border-foreground bg-primary px-6 py-16 text-primary-foreground">
        <p className="text-sm font-bold uppercase tracking-widest">RONIA Business</p>
        <h1 className="mt-4 text-5xl font-black leading-none tracking-tight">
          Sell fast.<br />Count right.
        </h1>
        <p className="mt-6 max-w-md text-lg font-medium">
          The till and back office built for busy Kenyan counters.
        </p>
      </div>
      <div className="flex flex-col gap-3 p-6">
        <Button asChild size="lg" className="h-16 text-xl font-black">
          <Link to="/auth">Sign in</Link>
        </Button>
        <Button asChild size="lg" variant="secondary" className="h-16 border-2 border-foreground text-xl font-black">
          <Link to="/select">Go to my business</Link>
        </Button>
      </div>
    </div>
  );
}
