import { hermes, relay } from "@/lib/hermes";

/** Answer an approval.request (e.g. a Beds24 write). Hermes wants exactly request_id, execution_generation, choice. */
export async function POST(req: Request) {
  const { run_id, request_id, execution_generation, choice } = await req.json();
  return relay(await hermes(`/v1/runs/${run_id}/approval`, {
    method: "POST",
    body: JSON.stringify({ request_id, execution_generation, choice }),
  }));
}
