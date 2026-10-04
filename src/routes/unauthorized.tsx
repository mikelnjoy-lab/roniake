import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/unauthorized")({
  head: () => ({
    meta: [
      { title: "No access — RONIA Business" },
      { name: "description", content: "You don't have access to this business or branch." },
      { property: "og:title", content: "No access — RONIA Business" },
      { property: "og:description", content: "You don't have access to this business or branch." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <h1 className="text-4xl font-black">No access</h1>
      <p className="max-w-sm text-lg font-semibold text-muted-foreground">
        Your access to that business or branch was removed or never granted. Ask the owner if this is a mistake.
      </p>
      <Button asChild size="lg" className="h-14 px-8 text-lg font-black"><Link to="/select">Choose again</Link></Button>
    </div>
  ),
});
