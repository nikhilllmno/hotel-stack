import "server-only";

/** Server-side client for Doss's Hermes API server. The key never reaches the browser. */
export function hermes(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${process.env.HERMES_API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${process.env.HERMES_API_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
}

/** Pass a Hermes JSON response through unchanged (status included). */
export async function relay(res: Response): Promise<Response> {
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
}
