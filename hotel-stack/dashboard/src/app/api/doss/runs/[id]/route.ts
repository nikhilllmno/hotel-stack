import { hermes, relay } from "@/lib/hermes";

/** A run's live state; `pending_controls` holds Doss's open questions (clarify) while it waits for the owner. */
export async function GET(_req: Request, ctx: RouteContext<"/api/doss/runs/[id]">) {
  const { id } = await ctx.params;
  return relay(await hermes(`/v1/runs/${id}`));
}
