export const SERVICE_UNAVAILABLE_MESSAGE = "This service is not currently available. Please try again later.";

/** Keep upstream provider failures and challenge pages out of customer-facing UI. */
export function customerSafeError(error: unknown, fallback = SERVICE_UNAVAILABLE_MESSAGE): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/PAIRGATE_|Cloudflare|Just a moment|challenge-platform|challenges\.cloudflare\.com|<\s*!doctype|<\s*html|fetch failed|timed?\s*out|ECONN|ENOTFOUND|network error/i.test(message)) {
    return SERVICE_UNAVAILABLE_MESSAGE;
  }
  // Never return markup or an unexpectedly large upstream response to a browser.
  if (message.length > 240 || /<[^>]+>/.test(message)) return fallback;
  return message || fallback;
}
