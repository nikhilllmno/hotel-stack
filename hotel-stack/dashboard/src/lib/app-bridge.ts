/**
 * The script injected into owner mini apps (sandboxed iframe, opaque origin). The app calls
 *   await window.hotel.get("reservations", { arrival_from, arrival_to })
 *   await window.hotel.act("propose_texts", { reason, items })
 * and the dashboard page answers over postMessage after checking the request against an allow-list.
 */
/**
 * Owner apps see guest data, so they get no network of their own: no fetch/XHR/WebSocket (connect-src 'none'), no real
 * form posts, images only inline (data:), fonts only from Google. Data reaches them only through the bridge below.
 */
export const OWNER_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; ` +
  `style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; ` +
  `connect-src 'none'; form-action 'none'; base-uri 'none'">`;

export const OWNER_BRIDGE = OWNER_CSP + `<script>
window.hotel = (() => {
  let next = 0;
  const waiting = new Map();
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || !m.__hotelReply || !waiting.has(m.id)) return;
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    m.ok ? w.resolve(m.data) : w.reject(new Error(m.error));
  });
  const call = (msg) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    parent.postMessage({ __hotel: true, id, ...msg }, "*");
  });
  return {
    get: (source, params = {}) => call({ kind: "get", source, params }),
    act: (type, payload = {}) => call({ kind: "act", type, payload }),
  };
})();
</script>
`;

export function withBridge(html: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (!head || head.index === undefined) return OWNER_BRIDGE + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + OWNER_BRIDGE + html.slice(at);
}
