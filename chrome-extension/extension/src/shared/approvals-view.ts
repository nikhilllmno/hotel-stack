/**
 * The part of a pending approval the side panel may read. The service worker files one record per needs_approval
 * result (src/background/approvals.ts) in chrome.storage.session under APPROVALS_KEY. Hermes truncates long approval
 * arguments, so the side panel looks the record up by approval_id and shows `summary` instead of the cut-off text.
 */

export const APPROVALS_KEY = "hermes-approvals";

export type ApprovalView = {
  id: string;        // "ap_" + 12 characters
  expiresAt: number; // ms since epoch
  summary: string;   // what will happen, from the extension's own facts, e.g. 'Click button "Save" on https://...'
  pageUrl: string;   // the agent tab's URL when the approval was filed
};

/** The unexpired record for an approval id, or undefined. Never throws. */
export async function readApproval(id: string): Promise<ApprovalView | undefined> {
  try {
    const stored = (await chrome.storage.session.get(APPROVALS_KEY))[APPROVALS_KEY] as ApprovalView[] | undefined;
    const found = stored?.find((a) => a.id === id);
    return found && found.expiresAt > Date.now() && typeof found.summary === "string" ? found : undefined;
  } catch {
    return undefined;
  }
}
