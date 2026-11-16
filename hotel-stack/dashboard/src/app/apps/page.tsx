import { Suspense } from "react";
import Link from "next/link";
import { core, type MiniAppRow } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, Loading, PageHeader } from "@/components/ui";

async function Content() {
  const apps = await core.get<MiniAppRow[]>("/api/apps");
  return (
    <>
      <PageHeader title="Apps" subtitle="Small pages Doss built for you and your guests. Ask Doss in the chat to build or change one." />
      {apps.length === 0 ? (
        <Card><EmptyState>{"No apps yet. Try asking Doss: build me a board of this week's arrivals with unpaid deposits highlighted."}</EmptyState></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => (
            <Card key={a.slug} title={a.title} right={<Badge tone={a.public ? "blue" : "neutral"}>{a.public ? "public" : "owner"}</Badge>}
              description={a.description} className="mb-0">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Link href={`/apps/${a.slug}`} className="font-medium underline underline-offset-4">Open</Link>
                {a.public_url && <a href={a.public_url} target="_blank" rel="noreferrer" className="text-muted-foreground underline underline-offset-4">Public link</a>}
                <span className="text-xs text-muted-foreground">v{a.version} · {dateTime(a.updated_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Loading />}><Content /></Suspense>;
}
