"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { withBridge } from "@/lib/app-bridge";

/** Runs an owner mini app in a sandbox (no same-origin, no network of its own) and answers its window.hotel calls. */
export function AppFrame({ html, title, mode = "live" }: { html: string; title: string; mode?: "live" | "preview" | "public-preview" }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const doc = useMemo(() => withBridge(html), [html]);

  // The app calls window.hotel as soon as it loads. A layout effect attaches the listener in the same task that
  // inserts the iframe, so no early message can arrive first (a passive useEffect could run too late).
  useLayoutEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const m = e.data;
      if (e.source !== frame.current?.contentWindow || !m?.__hotel) return;
      const reply = (body: object) => frame.current?.contentWindow?.postMessage({ __hotelReply: true, id: m.id, ...body }, "*");
      if (m.kind === "act" && m.type === "ask_doss" && mode === "live") {
        router.push(`/doss?ask=${encodeURIComponent(String(m.payload?.prompt ?? ""))}`);
        return reply({ ok: true, data: null });
      }
      const r = await fetch("/api/apps/bridge", { method: "POST", body: JSON.stringify({ ...m, mode }) });
      reply(await r.json());
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, mode]);

  return <iframe ref={frame} title={title} srcDoc={doc} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
    className="h-[calc(100vh-9rem)] w-full rounded-xl bg-white ring-1 ring-border" />;
}
