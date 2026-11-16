import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Save an uploaded file where Doss's sandbox sees it (/uploads). Returns the path to mention in the message. */
export async function POST(req: Request) {
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "no file" }, { status: 400 });
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const name = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${safe}`;
  await writeFile(path.join(process.env.DOSS_UPLOADS_DIR!, name), Buffer.from(await file.arrayBuffer()));
  return Response.json({ path: `/uploads/${name}`, name: file.name, size: file.size });
}
