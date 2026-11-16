import { hermes, relay } from "@/lib/hermes";

/** Delete a Doss chat (Hermes refuses with 409 while a run or approval is still active). */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/doss/sessions/[id]">) {
  const { id } = await ctx.params;
  return relay(await hermes(`/api/sessions/${id}`, { method: "DELETE" }));
}
