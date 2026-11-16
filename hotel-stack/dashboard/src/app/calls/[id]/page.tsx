import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { core, type CallDetail, type Turn } from "@/lib/api";
import { dateTime, duration, label, money } from "@/lib/format";
import { Badge, Card, PageHeader, Loading } from "@/components/ui";
import { cn } from "@/lib/utils";

function TurnRow({ t }: { t: Turn }) {
  const at = <span className="w-10 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{(t.secondsFromStart ?? 0).toFixed(0)}s</span>;
  if (t.role === "tool_calls") {
    return (
      <>{(t.toolCalls ?? []).map((c, i) => (
        <div key={i} className="flex gap-3 text-xs">{at}
          <code className="rounded-md bg-sky-50 px-2 py-1 break-all text-sky-800">
            {c.function.name}({typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments)})
          </code>
        </div>
      ))}</>
    );
  }
  if (t.role === "tool_call_result") {
    return <div className="flex gap-3 text-xs">{at}<code className="line-clamp-2 rounded-md bg-muted px-2 py-1 break-all text-muted-foreground">{t.name}: {t.result}</code></div>;
  }
  const guest = t.role === "user";
  return (
    <div className="flex gap-3 text-sm">{at}
      <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2", guest ? "rounded-tl-sm bg-muted" : "rounded-tl-sm bg-primary/5 ring-1 ring-primary/10")}>
        <div className="mb-0.5 text-xs font-medium text-muted-foreground">{guest ? "Guest" : "Danny"}</div>
        {t.message}
      </div>
    </div>
  );
}

async function Content(props: PageProps<"/calls/[id]">) {
  const { id } = await props.params;
  const call = await core.get<CallDetail>(`/api/calls/${id}`);
  return (
    <>
      <Link href="/calls" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Call log
      </Link>
      <PageHeader title={call.caller_phone ? `Call from ${call.caller_phone}` : "Web call"}
        subtitle={`${dateTime(call.started_at)} · ${duration(call.duration_s)} · ended: ${label(call.ended_reason)}`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Conversation">
            <div className="space-y-2.5">{call.messages.map((t, i) => <TurnRow key={i} t={t} />)}</div>
          </Card>
        </div>
        <div>
          <Card title="Summary">
            <p className="mb-3 text-sm">{call.summary ?? "Analyzing…"}</p>
            <div className="flex flex-wrap gap-2">
              <Badge>{label(call.intent)}</Badge><Badge tone="blue">{label(call.outcome)}</Badge><Badge>{label(call.sentiment)}</Badge>
            </div>
          </Card>
          {call.booking_id && (
            <Card title="Booking made">
              <p className="text-sm">#{call.booking_id} · {money(call.booking_amount)} <span className="text-muted-foreground">(request until the deposit is paid)</span></p>
            </Card>
          )}
          {call.team_messages.length > 0 && (
            <Card title="Messages for the team">
              <div className="space-y-2">
                {call.team_messages.map((m) => (
                  <div key={m.id} className="flex items-start gap-2 text-sm"><Badge tone={m.status === "open" ? "amber" : "neutral"}>{m.status}</Badge> {m.reason}</div>
                ))}
              </div>
            </Card>
          )}
          {call.recording_url && (
            <Card title="Recording"><audio controls src={call.recording_url} className="w-full" /></Card>
          )}
          <Card title="Cost"><p className="text-sm tabular-nums">{money(call.cost_usd)}</p></Card>
        </div>
      </div>
    </>
  );
}

/** Live data: the page frame renders at once, data streams in (Cache Components). */
export default function Page(props: PageProps<"/calls/[id]">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
