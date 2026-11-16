/** "Page is now "Title" https://..." for the tab as it is right now. */
export async function pageLine(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return `Page is now "${tab.title ?? ""}" ${tab.url ?? ""}`;
}

/** The address with a scheme: "example.com/x" becomes "https://example.com/x"; "localhost:3000" too. */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^(about|mailto|chrome|javascript|data|view-source):/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
