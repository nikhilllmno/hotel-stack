import { useState, type KeyboardEvent } from "react";
import { ArrowUp, Globe, Square, TriangleAlert, X } from "lucide-react";
import type { BridgeStatus } from "../shared/protocol";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import type { TabInfo } from "../lib/context";

type Props = {
  tab: TabInfo | null;
  bridge: BridgeStatus["bridge"];
  running: boolean;
  onSend: (text: string, tab: TabInfo | null) => void;
  onStop: () => void;
  onOpenSettings: () => void;
};

const BRIDGE_WARNING: Partial<Record<BridgeStatus["bridge"], string>> = {
  disconnected: "Chrome is not connected: Hermes can chat but cannot use your tabs.",
  connecting: "Connecting to Chrome...",
  unauthorized: "Chrome bridge refused the token: Hermes cannot use your tabs. Check the bridge token in Settings.",
};

function TabChip({ tab, onDrop }: { tab: TabInfo; onDrop: () => void }) {
  const icon = tab.favIconUrl && /^https?:/.test(tab.favIconUrl) ? <img src={tab.favIconUrl} alt="" className="size-3 shrink-0 rounded-sm" /> : <Globe aria-hidden />;
  return (
    <Badge variant="secondary" className="max-w-full" title={`${tab.title ?? ""} ${tab.url ?? ""}`.trim()}>
      {icon}
      <span className="min-w-0 truncate">{tab.title || tab.url}</span>
      <button type="button" aria-label="Do not share this tab with the next message" onClick={onDrop}
        className="-mr-1 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <X className="size-3" aria-hidden />
      </button>
    </Badge>
  );
}

/** Message box: current-tab chip, bridge warning, Enter sends / Shift+Enter newline, Send that becomes Stop during a run. */
export function Composer({ tab, bridge, running, onSend, onStop, onOpenSettings }: Props) {
  const [text, setText] = useState("");
  const [dropped, setDropped] = useState(false);
  const warning = BRIDGE_WARNING[bridge];
  const canSend = text.trim().length > 0 && !running;
  const shown = tab && (tab.title || tab.url) && !tab.url?.startsWith("chrome-extension://") ? tab : null;

  const send = () => {
    if (!canSend) return;
    onSend(text, dropped ? null : shown);
    setText("");
    setDropped(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
      {warning && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{warning} {bridge !== "connecting" && <button type="button" onClick={onOpenSettings} className="cursor-pointer underline underline-offset-2 hover:text-foreground">Open settings</button>}</span>
        </p>
      )}
      {shown && !dropped && <div className="flex"><TabChip tab={shown} onDrop={() => setDropped(true)} /></div>}
      <div className="flex items-end gap-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} rows={1} aria-label="Message Hermes"
          placeholder="Ask Hermes to do something in Chrome" className="max-h-40 resize-none" />
        {running ? (
          <Button size="icon" aria-label="Stop" title="Stop" onClick={onStop}><Square /></Button>
        ) : (
          <Button size="icon" aria-label="Send" title="Send" disabled={!canSend} onClick={send}><ArrowUp /></Button>
        )}
      </div>
    </div>
  );
}
