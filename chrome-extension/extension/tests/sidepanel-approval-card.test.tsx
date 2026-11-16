import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApprovalCard } from "../src/sidepanel/ApprovalCard";
import { APPROVALS_KEY, type ApprovalView } from "../src/shared/approvals-view";
import type { Approval } from "../src/lib/hermes-events";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const record: ApprovalView = { id: "ap_123456789abc", expiresAt: Date.now() + 60_000, summary: 'Click button "Save"', pageUrl: "https://beds24.com/booking/90001" };
const stubStorage = (records: ApprovalView[] | undefined) =>
  vi.stubGlobal("chrome", { storage: { session: { get: async () => (records ? { [APPROVALS_KEY]: records } : {}) } } });

const CHROME_HEAD = "MCP tool 'act_with_approval' on UNTRUSTED server 'chrome' wants to run.\n\nArguments:\n";
const whole = (extra = {}) => ({
  runId: "r1", requestId: "q1", generation: 1, choices: ["once", "deny"], description: "Server 'chrome' is configured 'trust: untrusted'.",
  command: CHROME_HEAD + JSON.stringify({ approval_id: record.id, action: "click", ref: "e7", reason: "Save the booking note", ...extra }, null, 2),
}) as Approval;
const cut = (id = record.id): Approval => ({
  ...whole(),
  command: CHROME_HEAD + `{\n  "approval_id": "${id}",\n  "action": "type",\n  "reason": "Save the booking note",\n  "text": "Guest arrives late, please keep\n... [arguments truncated]`,
});
const unreadable = (): Approval => ({ ...whole(), command: CHROME_HEAD + "not json at all" });

const card = (a: Approval, onAnswer = vi.fn()) => render(<ApprovalCard approval={a} expired={false} onAnswer={onAnswer} />);
const approve = () => screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
const deny = () => screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement;
const CUT_OFF = "Arguments were cut off, so this action cannot be checked. Deny it and ask Doss to retry with a shorter reason.";

describe("ApprovalCard for a Chrome action", () => {
  it("shows what Chrome will do and the page from the service worker's record, with the reason, when it was found", async () => {
    stubStorage([record]);
    card(whole());
    expect(await screen.findByText('Chrome will: Click button "Save"')).toBeTruthy();
    expect(screen.getByText("https://beds24.com/booking/90001")).toBeTruthy();
    expect(screen.getByText("Save the booking note")).toBeTruthy();
    expect(screen.queryByText("Click element e7")).toBeNull();  // the model's own wording is replaced by the record
    expect(approve().disabled).toBe(false);
  });

  it("truncated arguments with a record: Approve is enabled and the record summary is shown", async () => {
    stubStorage([record]);
    const onAnswer = vi.fn();
    card(cut(), onAnswer);
    expect(await screen.findByText('Chrome will: Click button "Save"')).toBeTruthy();
    expect(screen.getByText("Save the booking note")).toBeTruthy();
    expect(screen.queryByText(CUT_OFF)).toBeNull();
    expect(approve().disabled).toBe(false);
    fireEvent.click(approve());
    expect(onAnswer).toHaveBeenCalledWith("once");
  });

  it("truncated arguments and no record: Approve is disabled, Deny works, and the card says why", async () => {
    stubStorage([{ ...record, id: "ap_other" }]);
    const onAnswer = vi.fn();
    card(cut(), onAnswer);
    expect((await screen.findByRole("note")).textContent).toContain(CUT_OFF);
    expect(approve().disabled).toBe(true);
    expect(deny().disabled).toBe(false);
    fireEvent.click(deny());
    expect(onAnswer).toHaveBeenCalledWith("deny");
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("truncated arguments with an expired record count as no record", async () => {
    stubStorage([{ ...record, expiresAt: Date.now() - 1 }]);
    card(cut());
    expect((await screen.findByRole("note")).textContent).toContain(CUT_OFF);
    expect(approve().disabled).toBe(true);
  });

  it("truncated arguments cut before the approval id: nothing to look up, so Approve is disabled", async () => {
    stubStorage([record]);
    card({ ...cut(), command: CHROME_HEAD + '{\n  "action": "type",\n  "reason": "Save the booking note",\n  "approval_id": "ap_1234\n... [arguments truncated]' });
    expect((await screen.findByRole("note")).textContent).toContain(CUT_OFF);
    expect(approve().disabled).toBe(true);
  });

  it("unreadable arguments: Approve is disabled, also when the id cannot be read out of them", async () => {
    stubStorage(undefined);
    const { unmount } = card(unreadable());
    expect((await screen.findByRole("note")).textContent).toContain(CUT_OFF);
    expect(approve().disabled).toBe(true);
    unmount();
    stubStorage([record]);
    card({ ...unreadable(), command: CHROME_HEAD + '{"approval_id": "' + record.id + '", broken' });
    expect(approve().disabled).toBe(true);  // no readable approval id: still cannot be checked
  });

  it("keeps Approve off while the record is still being read", () => {
    vi.stubGlobal("chrome", { storage: { session: { get: () => new Promise(() => {}) } } });
    card(cut());
    expect(approve().disabled).toBe(true);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("complete arguments and no record: Approve stays enabled with a muted note", async () => {
    stubStorage([]);
    card(whole());
    expect(await screen.findByText("Chrome has no record of this approval; it will ask again.")).toBeTruthy();
    expect(approve().disabled).toBe(false);
    expect(screen.getByText("Click element e7")).toBeTruthy();
    expect(screen.queryByText(CUT_OFF)).toBeNull();
  });

  it("still works when chrome.storage is not available", async () => {
    vi.stubGlobal("chrome", undefined);
    card(whole());
    expect(await screen.findByText(/Chrome has no record/)).toBeTruthy();
    expect(approve().disabled).toBe(false);
  });
});

describe("ApprovalCard for other tools", () => {
  const other: Approval = {
    runId: "r1", requestId: "q2", generation: 1, choices: ["once", "deny"], description: "Server 'composio' is configured 'trust: untrusted'.",
    command: "MCP tool 'send_email' on UNTRUSTED server 'composio' wants to run.\n\nArguments:\n" + JSON.stringify({ to: "a@b.c" }),
  };

  it("is unchanged: no record lookup, no notes, Approve enabled", async () => {
    const get = vi.fn(async () => ({}));
    vi.stubGlobal("chrome", { storage: { session: { get } } });
    card(other);
    await waitFor(() => expect(approve().disabled).toBe(false));
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByText(/Chrome has no record/)).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("truncated arguments keep the older warning with Approve enabled", () => {
    stubStorage([]);
    card({ ...other, command: "MCP tool 'send_email' on UNTRUSTED server 'composio' wants to run.\n\nArguments:\n{\n  \"to\": \"a@b.c\",\n  \"body\": \"Hel\n... [arguments truncated]" });
    expect(screen.getByRole("note").textContent).toContain("Arguments were cut off. Check the text below before approving.");
    expect(approve().disabled).toBe(false);
  });
});
