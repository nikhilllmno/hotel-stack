import { connection } from "next/server";
import { core } from "@/lib/api";

/** Unread report count for the sidebar badge. */
export async function GET() {
  await connection();
  const { unread } = await core.get<{ unread: number }>("/api/reports?limit=1");
  return Response.json({ unread });
}
