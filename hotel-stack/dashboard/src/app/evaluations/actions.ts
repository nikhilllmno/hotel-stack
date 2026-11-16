"use server";

import { revalidatePath } from "next/cache";
import { core } from "@/lib/api";

/** Starts an eval run on hotel core (~30 s, runs in the background there). */
export async function runEvals() {
  await core.post("/api/evals/run");
  revalidatePath("/evaluations");
}
