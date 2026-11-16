import { Suspense } from "react";
import Link from "next/link";
import { core, type ChangeDetail, type ChangeRow } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, ListLink, Loading, PageHeader, firstParam } from "@/components/ui";
import { ChangeFiles, ChecksList, GuestTexts, ReviewBox, STATUS_TONE, statusLabel } from "@/components/change-view";
import { Decision } from "./decision";

async function Content(props: PageProps<"/changes">) {
  const changes = await core.get<ChangeRow[]>("/api/changes?limit=100");
  const selected = Number(firstParam((await props.searchParams).id)) || changes[0]?.id;
  const change = selected ? await core.get<ChangeDetail>(`/api/changes/${selected}`) : null;
  const waiting = changes.filter((c) => c.status === "ready").length;

  return (
    <>
      <PageHeader title="Pending changes"
        subtitle={`Changes Doss proposes to Danny, the agents and the code. Nothing goes live until you approve it.${waiting ? ` ${waiting} waiting for you.` : ""}`} />
      {changes.length === 0 ? <Card><EmptyState>No changes yet. Ask Doss to change something in the chat.</EmptyState></Card> : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Changes">
            <div className="-mx-2 space-y-0.5">
              {changes.map((c) => (
                <ListLink key={c.id} active={c.id === selected} href={`/changes?id=${c.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">#{c.id} {c.title}</span>
                    <Badge tone={STATUS_TONE[c.status]}>{statusLabel(c)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.kind === "guest_texts" ? `guest texts · ${c.recipients} recipient${c.recipients === 1 ? "" : "s"}`
                      : `${c.areas.join(", ")} · ${c.paths.length} file${c.paths.length === 1 ? "" : "s"}`} · {dateTime(c.created_at)}
                  </div>
                </ListLink>
              ))}
            </div>
          </Card>
          {change && (
            <div className="lg:col-span-2">
              <Card title={`#${change.id} ${change.title}`} description={change.reason}
                right={<Badge tone={STATUS_TONE[change.status]}>{statusLabel(change)}</Badge>}>
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      Proposed by {change.created_by} · {dateTime(change.created_at)}
                      {change.decided_by && ` · ${change.status} by ${change.decided_by} ${dateTime(change.decided_at)}`}
                      {change.version_id && ` · published as Danny v${change.version_id}`}
                    </span>
                    <span className="flex items-center gap-3">
                      {change.kind === "mini_app" && (
                        <Link href={`/apps/preview/${change.id}`} className="text-sm font-medium text-foreground underline underline-offset-4">Preview app</Link>
                      )}
                      <Decision id={change.id} status={change.status} texts={change.kind === "guest_texts"} sendAt={change.send_at} />
                    </span>
                  </div>
                  {change.kind === "guest_texts" ? (
                    <div><h3 className="mb-2 text-sm font-semibold">Texts</h3><GuestTexts change={change} /></div>
                  ) : (
                    <>
                      <ReviewBox review={change.checks.review} />
                      <div><h3 className="mb-2 text-sm font-semibold">Checks</h3><ChecksList change={change} /></div>
                      <div><h3 className="mb-2 text-sm font-semibold">Changes to files</h3><ChangeFiles change={change} /></div>
                    </>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Live data: the page frame renders at once, data streams in (Cache Components). */
export default function Page(props: PageProps<"/changes">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
