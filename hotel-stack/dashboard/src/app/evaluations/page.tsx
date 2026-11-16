import { Suspense } from "react";
import { core, type EvalRun, type EvalRunRow } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, ListLink, PageHeader, StatCard, StatGrid, firstParam, Loading } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { runEvals } from "./actions";

async function Content(props: PageProps<"/evaluations">) {
  const runs = await core.get<EvalRunRow[]>("/api/evals");
  const selected = Number(firstParam((await props.searchParams).run)) || runs[0]?.id;
  const run = selected ? await core.get<EvalRun>(`/api/evals/${selected}`) : null;
  const accuracy = run ? Math.round((run.passed / run.total) * 100) : null;

  return (
    <>
      <PageHeader title="Evaluations" subtitle="Scripted guest conversations run against Danny's prompt and tools, graded by a judge model">
        <form action={runEvals}><Button type="submit">Run evals (~30 s)</Button></form>
      </PageHeader>

      {run && (
        <StatGrid>
          <StatCard label="Agent accuracy" value={`${accuracy}%`} hint={`Run #${run.id} · ${dateTime(run.started_at)}`} />
          <StatCard label="Passed" value={<span className="text-emerald-700">{run.passed}</span>} />
          <StatCard label="Failed" value={<span className={run.total - run.passed ? "text-red-700" : ""}>{run.total - run.passed}</span>} />
          <StatCard label="Scenarios" value={run.total} />
        </StatGrid>
      )}

      <div className="grid gap-6 lg:grid-cols-4">
        <Card title="Runs">
          {runs.length === 0 ? <EmptyState>No runs yet.</EmptyState> : (
            <div className="-mx-2 space-y-0.5">
              {runs.map((r) => (
                <ListLink key={r.id} active={r.id === selected} href={`/evaluations?run=${r.id}`} className="flex justify-between">
                  <span>#{r.id} · {dateTime(r.started_at)}</span>
                  <span className={cn("tabular-nums", r.passed === r.total ? "text-emerald-700" : "text-red-700")}>{r.passed}/{r.total}</span>
                </ListLink>
              ))}
            </div>
          )}
        </Card>
        <div className="lg:col-span-3">
          <Card title="Scenarios" description="Open a scenario to see the conversation and the judge's reasoning.">
            <div className="divide-y divide-border">
              {run?.results.map((r) => (
                <details key={r.name} className="group py-2.5">
                  <summary className="flex cursor-pointer list-none items-start gap-3 text-sm">
                    <Badge tone={r.passed ? "green" : "red"}>{r.passed ? "pass" : "fail"}</Badge>
                    <span className="flex-1">
                      <span className="font-medium">{r.name}</span>
                      {!r.passed && <span className="block text-muted-foreground">{r.reason}</span>}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-1 rounded-lg bg-muted p-3 font-mono text-xs">
                    {r.transcript.map((line, i) => <div key={i} className={line.startsWith("[tool") ? "text-sky-700" : ""}>{line}</div>)}
                    <div className="pt-2 font-sans text-muted-foreground">Judge: {r.reason}</div>
                  </div>
                </details>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Live data: the page frame renders at once, data streams in (Cache Components). */
export default function Page(props: PageProps<"/evaluations">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
