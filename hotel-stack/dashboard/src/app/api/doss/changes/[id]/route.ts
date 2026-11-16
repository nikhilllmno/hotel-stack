import { core, type ChangeDetail } from "@/lib/api";

/** Read-only view of one change for the chat's proposal card (approving happens on /changes). */
export async function GET(_req: Request, ctx: RouteContext<"/api/doss/changes/[id]">) {
  const { id } = await ctx.params;
  return Response.json(await core.get<ChangeDetail>(`/api/changes/${Number(id)}`));
}
