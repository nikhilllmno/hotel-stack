import { Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { core, type Report, type ReportRow } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, ListLink, Loading, PageHeader, firstParam } from "@/components/ui";
import { cn } from "@/lib/utils";
import { MarkRead } from "./mark-read";

/** Markdown in the dashboard's typography (no extra plugin): headings, lists, tables, links. */
const md = {
  h1: (p: object) => <h2 className="mt-5 mb-2 text-lg font-semibold first:mt-0" {...p} />,
  h2: (p: object) => <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0" {...p} />,
  h3: (p: object) => <h4 className="mt-4 mb-1.5 text-sm font-semibold" {...p} />,
  p: (p: object) => <p className="my-2 leading-6" {...p} />,
  ul: (p: object) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
  ol: (p: object) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
  a: (p: object) => <a className="underline underline-offset-4" {...p} />,
  table: (p: object) => <div className="my-3 overflow-x-auto"><table className="w-full text-sm" {...p} /></div>,
  th: (p: object) => <th className="border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground" {...p} />,
  td: (p: object) => <td className="border-b border-border px-2 py-1.5 align-top" {...p} />,
  code: (p: object) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...p} />,
};

async function Content(props: PageProps<"/reports">) {
  const { reports } = await core.get<{ unread: number; reports: ReportRow[] }>("/api/reports?limit=100");
  const selected = Number(firstParam((await props.searchParams).id)) || reports[0]?.id;
  const report = selected ? await core.get<Report>(`/api/reports/${selected}`) : null;

  return (
    <>
      <PageHeader title="Reports" subtitle="Summaries Doss writes for you: on a schedule, or when you ask in the chat." />
      {reports.length === 0 ? (
        <Card><EmptyState>{"No reports yet. Ask Doss for one, for example: every Monday, tell me what guests asked that Danny couldn't answer."}</EmptyState></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="All reports">
            <div className="-mx-2 space-y-0.5">
              {reports.map((r) => (
                <ListLink key={r.id} active={r.id === selected} href={`/reports?id=${r.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn(!r.read_at && "font-semibold")}>{r.title}</span>
                    {!r.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500" aria-label="unread" />}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.kind} · {dateTime(r.created_at)}</div>
                </ListLink>
              ))}
            </div>
          </Card>
          {report && (
            <div className="lg:col-span-2">
              <Card title={report.title} right={<Badge>{report.kind}</Badge>} description={dateTime(report.created_at)}>
                <MarkRead id={report.id} unread={!report.read_at} />
                <div className="text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{report.body}</ReactMarkdown></div>
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Live data: the page frame renders at once, data streams in (Cache Components). */
export default function Page(props: PageProps<"/reports">) {
  return <Suspense fallback={<Loading />}><Content {...props} /></Suspense>;
}
