import { useState, type FormEvent } from "react";
import { Check, LoaderCircle, X } from "lucide-react";
import { type Settings } from "../shared/protocol";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { CORS_ORIGINS_LINE, EXTENSION_ORIGIN, HermesClient, toHermesError } from "../lib/hermes-client";
import { isConfigured, loadBridgeStatus, saveSettings } from "../lib/settings";
import { CopyButton } from "./ErrorBanner";


export const HERMES_HELP = `# Hermes profile config.yaml
platforms:
  api_server:
    cors_origins: ["${EXTENSION_ORIGIN}"]
mcp_servers:
  chrome:
    command: uv
    args: ["run", "--project", "<repo>/chrome-extension/bridge", "python", "-m", "chrome_bridge.server"]
    trust: untrusted   # Hermes asks you before act_with_approval runs

# Hermes profile .env (the same values as above)
API_SERVER_KEY=<Hermes API key>
CHROME_BRIDGE_TOKEN=<bridge token>`;

type Result = { ok: boolean; text: string };

async function waitForBridge(): Promise<Result> {
  for (let i = 0; i < 10; i++) {
    const s = await loadBridgeStatus();
    if (s.bridge === "connected") return { ok: true, text: "Connected" };
    if (s.bridge === "unauthorized") return { ok: false, text: "The bridge refused the token. Use the same value as CHROME_BRIDGE_TOKEN in the Hermes profile." };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, text: "Not connected. Hermes starts the bridge when it starts: is Hermes running with the chrome MCP server configured?" };
}

function Field({ id, label, value, onChange, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">{label}</label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} />
    </div>
  );
}

function ResultLine({ name, r }: { name: string; r: Result | "testing" | undefined }) {
  if (!r) return null;
  return (
    <p className="flex items-start gap-2 text-xs" role="status">
      {r === "testing" ? <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
        : r.ok ? <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <X className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />}
      <span className={`min-w-0 break-words ${r !== "testing" && !r.ok ? "text-destructive" : ""}`}>
        <span className="font-medium">{name}: </span>{r === "testing" ? "Testing..." : r.text}
      </span>
    </p>
  );
}

type Props = { initial: Settings; firstRun: boolean; onSaved: (configured: boolean) => void };

/** Connection settings (chrome.storage.local, shared with the service worker) and the config lines Hermes needs. */
export function SettingsView({ initial, firstRun, onSaved }: Props) {
  const [form, setForm] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hermes, setHermes] = useState<Result | "testing">();
  const [bridge, setBridge] = useState<Result | "testing">();
  const set = (k: keyof Settings) => (v: string) => { setForm({ ...form, [k]: v }); setSaved(false); };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    await saveSettings(form);
    setSaving(false);
    setSaved(true);
    onSaved(isConfigured(form));
  };

  /** Saves first: the service worker reconnects to the bridge when the settings change, and that is what gets tested. */
  const test = async () => {
    await saveSettings(form);
    setSaved(true);
    setHermes("testing");
    setBridge("testing");
    void waitForBridge().then(setBridge);
    try {
      await new HermesClient(form).listSessions();
      setHermes({ ok: true, text: "Connected" });
    } catch (e) {
      setHermes({ ok: false, text: toHermesError(e, form.hermesUrl).message });
    }
  };

  return (
    <form onSubmit={save} className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        <div className="space-y-1">
          <h1 className="text-sm font-semibold">Settings</h1>
          <p className="text-xs text-muted-foreground">
            {firstRun ? "Add your Hermes API key and the bridge token to start. Both are in the Hermes profile .env." : "Where this extension finds Hermes and the Chrome bridge. Stored in this browser only."}
          </p>
        </div>
        <Field id="hermes-url" label="Hermes URL" value={form.hermesUrl} onChange={set("hermesUrl")} placeholder="http://127.0.0.1:8642" />
        <Field id="hermes-key" label="Hermes API key" type="password" value={form.hermesKey} onChange={set("hermesKey")} placeholder="API_SERVER_KEY" />
        <Field id="bridge-url" label="Bridge URL" value={form.bridgeUrl} onChange={set("bridgeUrl")} placeholder="ws://127.0.0.1:8765" />
        <Field id="bridge-token" label="Bridge token" type="password" value={form.bridgeToken} onChange={set("bridgeToken")} placeholder="CHROME_BRIDGE_TOKEN" />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={saving}>Save</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void test()}>Test connection</Button>
          {saved && <span className="text-xs text-muted-foreground" role="status">Saved</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <ResultLine name="Hermes" r={hermes} />
          <ResultLine name="Chrome bridge" r={bridge} />
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <h2 className="text-xs font-medium">Hermes setup</h2>
          <p className="text-xs text-muted-foreground">Hermes refuses requests from an origin it does not know. Add this to the Hermes profile and restart Hermes.</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre">{HERMES_HELP}</pre>
          <div className="flex gap-2">
            <CopyButton text={HERMES_HELP} label="Copy config" />
            <CopyButton text={CORS_ORIGINS_LINE} label="Copy origin line" />
          </div>
        </div>
      </div>
    </form>
  );
}
