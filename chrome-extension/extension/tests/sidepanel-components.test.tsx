import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApprovalCard } from "../src/sidepanel/ApprovalCard";
import { Composer } from "../src/sidepanel/Composer";
import type { Approval } from "../src/lib/hermes-events";

afterEach(cleanup);

const approval: Approval = {
  runId: "r1", requestId: "a1", generation: 1, choices: ["once", "deny"], description: "Server 'chrome' is configured 'trust: untrusted'.",
  command: `MCP tool 'act_with_approval' wants to run.\n\nArguments:\n{"action":"click","ref":"e7","reason":"Send the reply"}`,
};

describe("ApprovalCard", () => {
  it("shows the action and reason with Approve and Deny", () => {
    render(<ApprovalCard approval={approval} expired={false} onAnswer={() => {}} />);
    expect(screen.getByText("Hermes wants to:")).toBeTruthy();
    expect(screen.getByText("Click element e7")).toBeTruthy();
    expect(screen.getByText("Send the reply")).toBeTruthy();
  });

  it("leads with the reason, then the action, and shows the approval id small", () => {
    const withId: Approval = { ...approval, command: `Arguments:\n{"action":"click","ref":"e7","reason":"Send the reply","approval_id":"ap-77"}` };
    const { container } = render(<ApprovalCard approval={withId} expired={false} onAnswer={() => {}} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("Send the reply")).toBeGreaterThan(-1);
    expect(text.indexOf("Send the reply")).toBeLessThan(text.indexOf("Click element e7"));
    expect(screen.getByText("Approval ap-77")).toBeTruthy();
  });

  it("warns when Hermes cut the arguments, shows the raw text, and keeps Approve enabled", () => {
    const onAnswer = vi.fn();
    const cut: Approval = { ...approval, command: `MCP tool 'act_with_approval' wants to run.\n\nArguments:\n{\n  "action": "type",\n  "ref": "e3",\n  "reason": "Fill the note",\n  "text": "abc\n... [arguments truncated]` };
    render(<ApprovalCard approval={cut} expired={false} onAnswer={onAnswer} />);
    expect(screen.getByRole("note").textContent).toContain("Arguments were cut off");
    expect(screen.getByText("Fill the note")).toBeTruthy();
    expect(document.body.textContent).toContain('"text": "abc');
    const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(onAnswer).toHaveBeenCalledWith("once");
  });

  it("sends the choice, and does not claim Approved before Hermes answered", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(<ApprovalCard approval={approval} expired={false} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onAnswer).toHaveBeenCalledWith("once");
    rerender(<ApprovalCard approval={approval} state={{ phase: "posting", choice: "once" }} expired={false} onAnswer={onAnswer} />);
    expect((screen.getByRole("button", { name: "Approving..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Approved")).toBeNull();
    rerender(<ApprovalCard approval={approval} state={{ phase: "done", choice: "once" }} expired={false} onAnswer={onAnswer} />);
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("shows Denied, a failed post (buttons back) and an expired request", () => {
    const { rerender } = render(<ApprovalCard approval={approval} state={{ phase: "done", choice: "deny" }} expired={false} onAnswer={() => {}} />);
    expect(screen.getByText("Denied")).toBeTruthy();
    rerender(<ApprovalCard approval={approval} state={{ phase: "error", choice: "once", error: "Cannot reach Hermes" }} expired={false} onAnswer={() => {}} />);
    expect(screen.getByRole("alert").textContent).toBe("Cannot reach Hermes");
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
    rerender(<ApprovalCard approval={approval} expired onAnswer={() => {}} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("Composer", () => {
  const tab = { id: 1, title: "Bookings", url: "https://beds24.com" };
  const setup = (over: Partial<Parameters<typeof Composer>[0]> = {}) => {
    const onSend = vi.fn();
    render(<Composer tab={tab} bridge="connected" running={false} onSend={onSend} onStop={() => {}} onOpenSettings={() => {}} {...over} />);
    return { onSend, box: screen.getByLabelText("Message Hermes") as HTMLTextAreaElement };
  };

  it("sends on Enter with the tab, newline on Shift+Enter, and disables Send while empty", () => {
    const { onSend, box } = setup();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello", tab);
    expect(box.value).toBe("");
  });

  it("drops the tab for one message when the chip is removed", () => {
    const { onSend, box } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Do not share this tab/ }));
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi", null);
    expect(screen.getByText("Bookings")).toBeTruthy();  // back for the next message
  });

  it("becomes Stop while a run is active, and warns when Chrome is disconnected", () => {
    setup({ running: true, bridge: "disconnected" });
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByText(/Chrome is not connected: Hermes can chat but cannot use your tabs\./)).toBeTruthy();
  });
});
