import { Suspense } from "react";
import Link from "next/link";
import { core, type CallRow, type Stats } from "@/lib/api";
import { dateTime, duration, label, money } from "@/lib/format";
import { Badge, Card, DaysPicker, EmptyState, PageHeader, StatCard, StatGrid, fieldClass, firstParam, Loading } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const INTENTS = ["new_booking", "existing_booking", "modify_booking", "cancel_booking", "question", "complaint", "other"];
const OUTCOME_TONE: Record<string, "green" | "amber" | "red" | "blue" | "neutral"> = {
  booked: "green", modified: "green", message_taken: "blue", answered: "blue", quoted_no_booking: "amber", abandoned: "red",
};

function IntentBars({ intents }: { intents: Stats["intents"] }) {
  const total = intents.reduce((s, i) => s + i.n, 0) || 1;
  return (
    <div className="space-y-2.5">
      {intents.map((i) => (
        <div key={i.intent} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate capitalize text-muted-foreground">{label(i.intent)}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(i.n / total) * 100}%` }} />
          </div>
          <span className="text-right tabular-nums">{i.n}</span>
        </div>
      ))}
    </div>
  );
}

async function Content(props: PageProps<"/calls">) {
  const sp = await props.searchParams;
  const days = Number(firstParam(sp.days)) || 7;
  const intent = firstParam(sp.intent);
  const q = firstParam(sp.q);
  const query = new URLSearchParams({ days: String(days), intent, q });
  const [stats, calls] = await Promise.all([
    core.get<Stats>(`/api/stats?days=${days}`),
    core.get<CallRow[]>(`/api/calls?${query}`),
  ]);

  return (
    <>
      <PageHeader title="Call Insights" subtitle="Calls Danny answered, with Claude's summary of each">
        <DaysPicker days={days} base="/calls" params={{ intent, q }} />
      </PageHeader>

      <StatGrid>
        <StatCard label="Total calls" value={stats.calls} />
        <StatCard label="Total call duration" value={duration(stats.duration_s)} />
        <StatCard label="Bookings made" value={stats.bookings} />
        <StatCard label="Booking revenue" value={money(stats.booking_revenue)} />
      </StatGrid>

      <Card title="Caller intent" description={`What callers wanted, last ${days} days`}>
        {stats.intents.length === 0 ? <EmptyState>No calls in this period.</EmptyState> : <IntentBars intents={stats.intents} />}
      </Card>

      <Card title="Call log" right={
        <form className="flex gap-2">
          <input type="hidden" name="days" value={days} />
          <select name="intent" defaultValue={intent} className={fieldClass}>
            <option value="">All intents</option>
            {INTENTS.map((i) => <option key={i} value={i}>{label(i)}</option>)}
          </select>
          <input name="q" defaultValue={q} placeholder="Search calls…" className={`${fieldClass} w-48`} />
          <Button type="submit" size="sm">Filter</Button>
        </form>
      }>
        {calls.length === 0 ? <EmptyState>No calls found for this period.</EmptyState> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead><TableHead>Caller</TableHead><TableHead>Intent</TableHead><TableHead>Outcome</TableHead>
                <TableHead className="text-right">Duration</TableHead><TableHead className="text-right">Booking</TableHead><TableHead className="w-2/5">Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((c) => (
                <TableRow key={c.id} className="[&>td]:align-top">
                  <TableCell className="font-medium"><Link href={`/calls/${c.id}`} className="hover:underline">{dateTime(c.started_at)}</Link></TableCell>
                  <TableCell>{c.caller_phone ?? "Web call"}</TableCell>
                  <TableCell className="capitalize">{label(c.intent)}</TableCell>
                  <TableCell><Badge tone={OUTCOME_TONE[c.outcome ?? ""] ?? "neutral"}>{label(c.outcome)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{duration(c.duration_s)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.booking_id ? money(c.booking_amount) : "—"}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground"><p className="line-clamp-3">{c.summary ?? "Analyzing…"}</p></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** Live data: the page frame renders at once, data streams in (Cache Components). */
export default function Page(props: PageProps<"/calls">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
