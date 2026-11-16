import { getWorkableTab } from "../agent-tab";
import { cursor } from "../cursor";
import { cdp } from "../debugger";
import { CommandError } from "../errors";
import { visualViewport } from "../input";
import type { CommandOutput } from "./types";

/** Largest side of the returned image in pixels; bigger viewports are scaled down so the model gets a manageable picture. */
const MAX_SIDE = 1600;
/** Largest base64 payload. Results travel as one WebSocket message (the bridge allows 16 MiB), so stay well under that. */
const MAX_BASE64_CHARS = 8_000_000;

/** Capture attempts, best quality first: PNG as is, then JPEG at falling quality, then JPEG on a smaller image. */
const ATTEMPTS: { format: "png" | "jpeg"; quality?: number; shrink: number }[] = [
  { format: "png", shrink: 1 },
  { format: "jpeg", quality: 80, shrink: 1 },
  { format: "jpeg", quality: 60, shrink: 1 },
  { format: "jpeg", quality: 50, shrink: 0.7 },
  { format: "jpeg", quality: 40, shrink: 0.5 },
];

export async function screenshot(): Promise<CommandOutput> {
  const tab = await getWorkableTab();
  await cursor.hide(tab);  // the agent cursor must not cover page content the model is about to read
  try {
    return await capture(tab);
  } finally {
    await cursor.show(tab);
  }
}

async function capture(tab: Awaited<ReturnType<typeof getWorkableTab>>): Promise<CommandOutput> {
  const v = await visualViewport(tab);
  // Chrome sizes a capture in device pixels. Dividing the clip scale by the device pixel ratio makes one image pixel
  // one CSS pixel (times `fit`), which is the unit of the x,y coordinates the agent passes back to act.
  const dpr = await devicePixelRatio(tab);
  const fit = Math.min(1, MAX_SIDE / Math.max(v.clientWidth, v.clientHeight));

  let shot: { data: string; mime: "image/png" | "image/jpeg"; shrink: number } | undefined;
  for (const attempt of ATTEMPTS) {
    const scale = (fit * attempt.shrink) / dpr;
    const clip = { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale };
    const params = { format: attempt.format, clip, ...(attempt.quality ? { quality: attempt.quality } : {}) };
    const { data } = await cdp<{ data: string }>(tab, "Page.captureScreenshot", params);
    if (data.length <= MAX_BASE64_CHARS) {
      shot = { data, mime: attempt.format === "png" ? "image/png" : "image/jpeg", shrink: attempt.shrink };
      break;
    }
  }
  if (!shot) throw new CommandError("The screenshot is too large to send even when compressed. Use snapshot to read the page, or make the window smaller.");

  const total = fit * shot.shrink;
  const size = `${Math.round(v.clientWidth * total)}x${Math.round(v.clientHeight * total)}`;
  const note =
    total < 1
      ? ` The page's viewport is ${v.clientWidth}x${v.clientHeight} CSS px; multiply image coordinates by ${(1 / total).toFixed(2)} for x,y.`
      : " Image pixels equal viewport CSS pixels, usable as x,y.";
  const compressed = shot.mime === "image/jpeg" ? " (compressed to JPEG to keep it small)" : "";
  return { text: `Screenshot of "${tab.title ?? ""}" ${tab.url ?? ""} (${size} px)${compressed}.${note}`, image: { data: shot.data, mime: shot.mime } };
}

async function devicePixelRatio(tab: Parameters<typeof cdp>[0]): Promise<number> {
  const out = await cdp<{ result?: { value?: unknown } }>(tab, "Runtime.evaluate", { expression: "window.devicePixelRatio", returnByValue: true });
  const dpr = out.result?.value;
  return typeof dpr === "number" && dpr > 0 ? dpr : 1;
}
