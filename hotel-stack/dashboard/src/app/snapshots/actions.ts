"use server";

import { revalidatePath } from "next/cache";
import { core } from "@/lib/api";

/** Restores a version's config files and republishes them to Vapi as a new version. */
export async function rollback(versionId: number) {
  await core.post(`/api/versions/${versionId}/rollback?author=dashboard`);
  revalidatePath("/snapshots");
}
