import { hermes } from "@/lib/hermes";

/** The session's stored transcript (oldest first) plus its totals (model, cost), for rebuilding the chat. */
export async function GET(_req: Request, ctx: RouteContext<"/api/doss/sessions/[id]/messages">) {
  const { id } = await ctx.params;
  const [messages, session] = await Promise.all([
    hermes(`/api/sessions/${id}/messages?limit=500&order=oldest`),
    hermes(`/api/sessions/${id}`),
  ]);
  if (!messages.ok || !session.ok) {
    const failed = messages.ok ? session : messages;
    return new Response(await failed.text(), { status: failed.status, headers: { "Content-Type": "application/json" } });
  }
  const [m, s] = await Promise.all([messages.json(), session.json()]);
  return Response.json({ messages: m.data, session: s.session ?? s });
}
