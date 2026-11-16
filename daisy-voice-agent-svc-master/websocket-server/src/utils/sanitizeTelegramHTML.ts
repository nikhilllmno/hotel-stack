export function sanitizeTelegramHTML(input: string): string {
  return input
    .replace(/&/g, '&amp;') // Escape &
    .replace(/</g, '&lt;') // Escape <
    .replace(/>/g, '&gt;') // Escape >
    .replace(/–/g, '-') // En-dash to dash
    .replace(/—/g, '-') // Em-dash to dash
    .replace(/\u2028|\u2029/g, '') // Remove line separators
    .replace(/\u200B/g, ''); // Remove zero-width space
}
