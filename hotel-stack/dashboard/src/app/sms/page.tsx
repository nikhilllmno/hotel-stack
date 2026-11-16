import { Suspense } from "react";
import { core, type SmsMessage, type SmsThread } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Card, DaysPicker, EmptyState, ListLink, Loading, PageHeader, firstParam } from "@/components/ui";
import { cn } from "@/lib/utils";

function Bubble({ m }: { m: SmsMessage }) {
  const guest = m.direction === "in";
  return (
    <div className={cn("flex", guest ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[75%] rounded-2xl px-3.5 py-2 text-sm", guest ? "rounded-bl-sm bg-muted" : "rounded-br-sm bg-primary text-primary-foreground")}>
        <div className="whitespace-pre-wrap">{m.body}</div>
        <div className={cn("mt-1 text-xs", guest ? "text-muted-foreground" : "text-primary-foreground/60")}>
          {guest ? "Guest" : "Danny"} · {dateTime(m.created_at)}
        </div>
        {m.tools && m.tools.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.tools.map((t, j) => (
              <code key={j} className={cn("rounded px-1.5 py-0.5 text-[11px]", t.ok ? (guest ? "bg-background" : "bg-primary-foreground/15") : "bg-red-100 text-red-800")}>{t.name}</code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function Content(props: PageProps<"/sms">) {
  const sp = await props.searchParams;
  const days = Number(firstParam(sp.days)) || 30;
  const threads = await core.get<SmsThread[]>(`/api/sms?days=${days}`);
  const phone = firstParam(sp.phone) || threads[0]?.guest_phone;
  const messages = phone ? await core.get<SmsMessage[]>(`/api/sms/${encodeURIComponent(phone)}`) : [];

  return (
    <>
      <PageHeader title="SMS logs" subtitle="Text conversations Danny handled on the hotel's number">
        <DaysPicker days={days} base="/sms" />
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Guests" description={`${threads.length} conversation${threads.length === 1 ? "" : "s"}`}>
          {threads.length === 0 ? <EmptyState>No texts in this period.</EmptyState> : (
            <div className="-mx-2 space-y-0.5">
              {threads.map((t) => (
                <ListLink key={t.guest_phone} active={t.guest_phone === phone} href={{ pathname: "/sms", query: { days, phone: t.guest_phone } }}>
                  <div className="flex justify-between gap-2"><span className="font-medium">{t.guest_phone}</span><span className="text-xs text-muted-foreground">{dateTime(t.last_at)}</span></div>
                  <div className="truncate text-muted-foreground">{t.last_body}</div>
                </ListLink>
              ))}
            </div>
          )}
        </Card>
        <div className="lg:col-span-2">
          <Card title={phone ? `Conversation with ${phone}` : "Conversation"}>
            {messages.length === 0 ? <EmptyState>Pick a conversation.</EmptyState> : (
              <div className="space-y-3">{messages.map((m, i) => <Bubble key={i} m={m} />)}</div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** Live data: the page frame renders at once, data streams in (Cache Components). */
export default function Page(props: PageProps<"/sms">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
