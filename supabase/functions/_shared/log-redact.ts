/**
 * Helpers that keep operational logs useful for debugging without writing
 * personal data (email addresses) or message content (email subjects, full
 * provider response bodies) into log storage that operational readers can see.
 */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Mask one address, keeping the first character of the local part and the
 * full domain: `alice.smith@popcreations.com` -> `a***@popcreations.com`.
 * The domain stays so delivery problems can be grouped by provider or company.
 */
export function maskEmail(address: string | null | undefined): string {
  if (!address) return "<none>";
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return "<masked>";
  return `${address.charAt(0)}***${address.slice(at)}`;
}

/** Replace every email address found inside free text with its masked form. */
export function maskEmailsInText(text: string): string {
  return text.replace(EMAIL_PATTERN, (match) => maskEmail(match));
}

/**
 * Describe a subject line without writing it: only its length is logged, which
 * still tells a reader whether the subject was empty or unexpectedly long.
 */
export function describeSubject(subject: string | null | undefined): string {
  return `subject_chars=${subject ? subject.length : 0}`;
}

/**
 * Summarize a provider response body for logs and returned diagnostics.
 *
 * JSON bodies are reduced to their `code`, `message` and `messageId` fields.
 * Anything else keeps only its leading characters. Email addresses are masked
 * in both cases, and the result is capped at `maxLength` characters.
 */
export function summarizeProviderBody(raw: string, maxLength = 200): string {
  let summary: string;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof parsed.code === "string") parts.push(`code=${parsed.code}`);
    if (typeof parsed.message === "string") parts.push(`message=${parsed.message}`);
    if (typeof parsed.messageId === "string") parts.push(`messageId=${parsed.messageId}`);
    summary = parts.length > 0 ? parts.join(" ") : `json_keys=${Object.keys(parsed).join(",")}`;
  } catch {
    summary = raw;
  }
  const masked = maskEmailsInText(summary);
  return masked.length > maxLength ? `${masked.slice(0, maxLength)}...` : masked;
}
