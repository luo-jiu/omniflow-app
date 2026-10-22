/** Document links may open web pages, but never resolve relative to the app shell. */
export function normalizeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim();
  try {
    const url = new URL(input.startsWith('//') ? `https:${input}` : input);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
