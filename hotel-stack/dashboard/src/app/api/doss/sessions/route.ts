import { connection } from "next/server";
import { hermes, relay } from "@/lib/hermes";

/** Doss chats started from the dashboard (Hermes api_server sessions), newest first. */
export async function GET() {
  await connection();
  return relay(await hermes("/api/sessions?source=api_server&limit=50"));
}

export async function POST(req: Request) {
  const { title } = await req.json();
  return relay(await hermes("/api/sessions", { method: "POST", body: JSON.stringify({ title: title || "New chat" }) }));
}
