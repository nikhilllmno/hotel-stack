import { getWorkableTab } from "../agent-tab";
import { cdp } from "../debugger";
import { visualViewport } from "../input";
import type { CommandOutput } from "./types";

/** Largest side of the returned image in pixels; bigger viewports are scaled down so the model gets a manageable picture. */
const MAX_SIDE = 1600;

export async function screenshot(): Promise<CommandOutput> {
  const tab = await getWorkableTab();
  const v = await visualViewport(tab);
  const scale = Math.min(1, MAX_SIDE / Math.max(v.clientWidth, v.clientHeight));
  const clip = { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale };
  const { data } = await cdp<{ data: string }>(tab, "Page.captureScreenshot", { format: "png", clip });
  const size = `${Math.round(v.clientWidth * scale)}x${Math.round(v.clientHeight * scale)}`;
  const note = scale < 1 ? ` The page's viewport is ${v.clientWidth}x${v.clientHeight} CSS px; multiply image coordinates by ${(1 / scale).toFixed(2)} for x,y.` : " Image pixels equal viewport CSS pixels, usable as x,y.";
  return { text: `Screenshot of "${tab.title ?? ""}" ${tab.url ?? ""} (${size} px).${note}`, image: { data, mime: "image/png" } };
}
