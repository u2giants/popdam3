export type OpenRouterPricing = {
  prompt?: string | number | null;
  completion?: string | number | null;
};

function formatPerMillionTokenPrice(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "?";
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "?";

  const perMillion = parsed * 1_000_000;
  if (perMillion === 0) return "0";
  if (perMillion >= 1) return perMillion.toFixed(2).replace(/\.00$/, "");
  if (perMillion >= 0.01) return perMillion.toFixed(2);
  if (perMillion >= 0.001) return perMillion.toFixed(3);
  return perMillion.toFixed(4);
}

function parseTokenPrice(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasUnavailableOpenRouterPricing(pricing: OpenRouterPricing | null | undefined) {
  const prompt = parseTokenPrice(pricing?.prompt);
  const completion = parseTokenPrice(pricing?.completion);
  return (prompt !== null && prompt < 0) || (completion !== null && completion < 0);
}

export function formatOpenRouterPricing(pricing: OpenRouterPricing | null | undefined) {
  if (hasUnavailableOpenRouterPricing(pricing)) return undefined;
  if (!pricing?.prompt && !pricing?.completion) return undefined;
  return `$${formatPerMillionTokenPrice(pricing.prompt)}/$${formatPerMillionTokenPrice(pricing.completion)}`;
}
