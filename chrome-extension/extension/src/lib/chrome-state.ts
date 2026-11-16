import { useEffect, useState } from "react";
import { SETTINGS_KEY, STATUS_KEY, type BridgeStatus, type Settings } from "../shared/protocol";
import type { TabInfo } from "./context";
import { loadBridgeStatus, loadSettings } from "./settings";

/** Settings from chrome.storage.local, live. `null` while loading. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => alive && setSettings(s));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[SETTINGS_KEY]) loadSettings().then((s) => alive && setSettings(s));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);
  return settings;
}

/** The service worker's BridgeStatus (chrome.storage.session), live. */
export function useBridgeStatus(): BridgeStatus {
  const [status, setStatus] = useState<BridgeStatus>({ bridge: "disconnected" });
  useEffect(() => {
    let alive = true;
    loadBridgeStatus().then((s) => alive && setStatus(s));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[STATUS_KEY]) setStatus((changes[STATUS_KEY].newValue as BridgeStatus | undefined) ?? { bridge: "disconnected" });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => { alive = false; chrome.storage.onChanged.removeListener(onChanged); };
  }, []);
  return status;
}

const toInfo = (t: chrome.tabs.Tab | undefined): TabInfo | null => (t ? { id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl } : null);

/** The active tab of the last focused window, kept up to date. */
export function useActiveTab(): TabInfo | null {
  const [tab, setTab] = useState<TabInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((ts) => alive && setTab(toInfo(ts[0]))).catch(() => {});
    refresh();
    const onUpdated = (id: number, _change: unknown, t: chrome.tabs.Tab) => setTab((cur) => (cur?.id === id || t.active ? toInfo(t) : cur));
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows?.onFocusChanged.addListener(refresh);
    return () => {
      alive = false;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows?.onFocusChanged.removeListener(refresh);
    };
  }, []);
  return tab;
}

/** `.dark` on <html> follows prefers-color-scheme, live. */
export function useColorScheme(): void {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}
