import { Suspense } from "react";
import { core, type Bookings } from "@/lib/api";
import { dateTime, label, money } from "@/lib/format";
import { Badge, Card, DaysPicker, EmptyState, PageHeader, StatCard, StatGrid, firstParam, Loading } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "neutral"> = { confirmed: "green", new: "green", request: "amber", cancelled: "red" };

async function Content(props: PageProps<"/bookings">) {
  const days = Number(firstParam((await props.searchParams).days)) || 30;
  const b = await core.get<Bookings>(`/api/bookings?days=${days}`);
  return (
    <>
      <PageHeader title="Bookings" subtitle="Reservations made in Beds24 in this period (live from the PMS)">
        <DaysPicker days={days} base="/bookings" />
      </PageHeader>
      <StatGrid>
        <StatCard label="Total revenue" value={money(b.revenue)} />
        <StatCard label="Deposits collected" value={money(b.collected)} />
        <StatCard label="New bookings" value={b.new_bookings} />
        <StatCard label="Made by Danny" value={b.by_danny} />
      </StatGrid>
      <Card title="Reservations" description="Newest first. Booking requests become confirmed once the deposit is paid.">
        {b.items.length === 0 ? <EmptyState>No bookings in this period.</EmptyState> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead><TableHead>Channel</TableHead><TableHead>Booked</TableHead><TableHead>Stay</TableHead>
                <TableHead>Room</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Deposit</TableHead><TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {b.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">{i.guest || "—"} {i.by_danny && <Badge tone="blue">Danny</Badge>}</div>
                    <div className="text-xs text-muted-foreground">#{i.id}</div>
                  </TableCell>
                  <TableCell className="capitalize">{i.channel}</TableCell>
                  <TableCell>{dateTime(i.booked_at)}</TableCell>
                  <TableCell>{i.arrival} → {i.departure}</TableCell>
                  <TableCell>{i.room}</TableCell>
                  <TableCell><Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{label(i.status)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{money(i.deposit)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(i.total)}</TableCell>
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
export default function Page(props: PageProps<"/bookings">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
