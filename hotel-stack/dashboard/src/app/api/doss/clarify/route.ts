import { hermes, relay } from "@/lib/hermes";

/** Answer one of Doss's questions. Hermes wants exactly request_id, execution_generation, answer. */
export async function POST(req: Request) {
  const { run_id, request_id, execution_generation, answer } = await req.json();
  return relay(await hermes(`/v1/runs/${run_id}/clarify`, {
    method: "POST",
    body: JSON.stringify({ request_id, execution_generation, answer }),
  }));
}
