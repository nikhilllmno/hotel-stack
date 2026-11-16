import { History, Plus, Settings as SettingsIcon } from "lucide-react";
import type { BridgeStatus } from "../shared/protocol";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import type { HermesState } from "./use-chat";

type Tone = "ok" | "wait" | "off" | "bad";

const DOT: Record<Tone, string> = {
  ok: "bg-green-500",
  wait: "animate-pulse bg-muted-foreground",
  off: "bg-muted-foreground",
  bad: "bg-destructive",
};

const HERMES: Record<HermesState, [Tone, string]> = {
  connected: ["ok", "connected"],
  connecting: ["wait", "connecting"],
  disconnected: ["off", "not connected"],
  refused: ["bad", "key or origin refused"],
};

const BRIDGE: Record<BridgeStatus["bridge"], [Tone, string]> = {
  connected: ["ok", "connected"],
  connecting: ["wait", "connecting"],
  disconnected: ["off", "not connected"],
  unauthorized: ["bad", "token refused"],
};

function Status({ name, tone, text }: { name: string; tone: Tone; text: string }) {
  return (
    <Badge variant="outline" title={`${name}: ${text}`} aria-label={`${name}: ${text}`}>
      <span className={`size-1.5 rounded-full ${DOT[tone]}`} aria-hidden />
      {name}
    </Badge>
  );
}

type Props = {
  hermes: HermesState; bridge: BridgeStatus["bridge"];
  onNew: () => void; onChats: () => void; onSettings: () => void;
};

/** Header row: connection state of Hermes and of the Chrome bridge, and the New chat / Chats / Settings buttons. */
export function StatusBar({ hermes, bridge, onNew, onChats, onSettings }: Props) {
  const [ht, hText] = HERMES[hermes];
  const [bt, bText] = BRIDGE[bridge];
  return (
    <header className="flex items-center gap-1.5 border-b border-border px-3 py-2">
      <Status name="Hermes" tone={ht} text={hText} />
      <Status name="Chrome" tone={bt} text={bText} />
      <div className="ml-auto flex items-center">
        <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={onNew}><Plus /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Chats" title="Chats" onClick={onChats}><History /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Settings" title="Settings" onClick={onSettings}><SettingsIcon /></Button>
      </div>
    </header>
  );
}
