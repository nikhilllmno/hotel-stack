import { hermes } from "@/lib/hermes";

/** One chat turn: forwards Hermes' SSE stream (deltas, tool events, approvals, run.completed) to the browser. */
export async function POST(req: Request, ctx: RouteContext<"/api/doss/sessions/[id]/stream">) {
  const { id } = await ctx.params;
  const { message } = await req.json();
  const upstream = await hermes(`/api/sessions/${id}/chat/stream`, { method: "POST", body: JSON.stringify({ message }) });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
  });
}
