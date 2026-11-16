"use server";

import { revalidatePath } from "next/cache";
import { core } from "@/lib/api";

/** Owner decisions on a change. Only the dashboard (owner key) can call these; Doss's key gets 403 from core. */
export async function decide(id: number, action: "approve" | "reject" | "undo"): Promise<{ error?: string }> {
  try {
    await core.post(`/api/changes/${id}/${action}`);
  } catch (e) {
    const text = String(e);
    const detail = text.match(/"detail":"([^"]+)"/)?.[1];
    return { error: detail ?? text };
  } finally {
    revalidatePath("/changes");
  }
  return {};
}
