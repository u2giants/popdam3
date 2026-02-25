/**
 * Truncate a filename with middle ellipsis, always preserving the extension.
 * Example: "VSZ4RVMSB04-closeup-final-version.psd" → "VSZ4RVM…rsion.psd"
 *
 * @param filename  Full filename string
 * @param maxLen    Maximum character length (default 28)
 */
export function formatFilename(filename: string, maxLen = 28): string {
  if (filename.length <= maxLen) return filename;

  // Find extension (last dot)
  const dotIndex = filename.lastIndexOf(".");
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : ""; // e.g. ".psd"
  const name = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;

  // We need room for: prefix + "…" + suffix-of-name + ext
  // Always keep at least the extension + 1 char of the suffix
  const ellipsis = "…";
  const reserved = ellipsis.length + ext.length; // 1 + 4 = 5
  const available = maxLen - reserved;

  if (available <= 2) {
    // Extremely tight — just show start + ext
    return filename.slice(0, maxLen - ext.length - 1) + ellipsis + ext;
  }

  // Split available space: ~60% prefix, ~40% suffix of the name part
  const prefixLen = Math.ceil(available * 0.6);
  const suffixLen = available - prefixLen;

  const prefix = name.slice(0, prefixLen);
  const suffix = suffixLen > 0 ? name.slice(-suffixLen) : "";

  return prefix + ellipsis + suffix + ext;
}
