import { hermes, relay } from "@/lib/hermes";

/** Stop Doss's current run (the composer's cancel button). */
export async function POST(req: Request) {
  const { run_id } = await req.json();
  return relay(await hermes(`/v1/runs/${run_id}/stop`, { method: "POST", body: "{}" }));
}
