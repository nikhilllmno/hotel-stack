import { Suspense } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { core, type Version, type VersionDiff } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, ListLink, PageHeader, firstParam, Loading } from "@/components/ui";
import { cn } from "@/lib/utils";
import { RollbackButton } from "./rollback-button";

function DiffLine({ line }: { line: string }) {
  const tone = line.startsWith("+") && !line.startsWith("+++") ? "bg-emerald-50 text-emerald-900"
    : line.startsWith("-") && !line.startsWith("---") ? "bg-red-50 text-red-900" : line.startsWith("@@") ? "text-sky-700" : "text-muted-foreground";
  return <div className={cn("px-3 whitespace-pre-wrap", tone)}>{line || " "}</div>;
}

function SyncBanner({ sync }: { sync: { in_sync: boolean; problems: string[] } }) {
  return (
    <div className={cn("mb-6 flex gap-3 rounded-xl p-4 text-sm ring-1",
      sync.in_sync ? "bg-emerald-50 text-emerald-900 ring-emerald-600/15" : "bg-amber-50 text-amber-950 ring-amber-600/20")}>
      {sync.in_sync ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
      <div>
        {sync.in_sync ? "Vapi is in sync with the repo: live calls use the latest version shown here."
          : <>Vapi was changed outside the repo. Copy wanted changes into the hotel files and publish, or discard the Vapi UI draft:
              <ul className="mt-1 list-disc pl-5">{sync.problems.map((p) => <li key={p}>{p}</li>)}</ul></>}
      </div>
    </div>
  );
}

async function Content(props: PageProps<"/snapshots">) {
  const [versions, sync] = await Promise.all([
    core.get<Version[]>("/api/versions"),
    core.get<{ in_sync: boolean; problems: string[] }>("/api/vapi/drift"),
  ]);
  const selected = Number(firstParam((await props.searchParams).v)) || versions[0]?.id;
  const diff = selected ? await core.get<VersionDiff>(`/api/versions/${selected}/diff`) : null;
  const live = versions[0]?.id;

  return (
    <>
      <PageHeader title="AI Snapshots" subtitle="Every publish of Danny: what changed, who changed it, and one-click rollback" />
      <SyncBanner sync={sync} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Versions">
          <div className="-mx-2 space-y-0.5">
            {versions.map((v) => (
              <ListLink key={v.id} active={v.id === selected} href={`/snapshots?v=${v.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">v{v.id}{v.id === live && <Badge tone="green">live</Badge>}</span>
                  <span className="text-xs text-muted-foreground">{v.author}</span>
                </div>
                <div className="text-muted-foreground">{v.note || "—"}</div>
                <div className="text-xs text-muted-foreground">{dateTime(v.created_at)}</div>
              </ListLink>
            ))}
          </div>
        </Card>
        <div className="lg:col-span-2">
          {diff && (
            <Card title={diff.against ? `v${diff.version} compared with v${diff.against}` : `v${diff.version} (first version)`}
              right={diff.version !== live ? <RollbackButton versionId={diff.version} /> : <Badge tone="green">Live now</Badge>}>
              {Object.keys(diff.files).length === 0 ? <EmptyState>No file changes.</EmptyState> : (
                <div className="space-y-4">
                  {Object.entries(diff.files).map(([path, text]) => (
                    <div key={path} className="overflow-x-auto rounded-lg font-mono text-xs ring-1 ring-border">
                      <div className="border-b border-border bg-muted px-3 py-1.5 font-medium">{path}</div>
                      <div className="py-1">{text.split("\n").map((line, i) => <DiffLine key={i} line={line} />)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Live data: the page frame renders at once, data streams in (Cache Components). */
export default function Page(props: PageProps<"/snapshots">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
