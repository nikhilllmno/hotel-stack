"use server";

import { revalidatePath } from "next/cache";
import { core } from "@/lib/api";

/** Opening a report marks it read (owner key; Doss cannot). */
export async function markRead(id: number) {
  await core.post(`/api/reports/${id}/read`);
  revalidatePath("/reports");
}
