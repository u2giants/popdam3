/** "1,000+" for a lower-bound count, "1,000" for an exact one (popdam3#97). */
export function formatCount(value: number, lowerBound = false): string {
  return `${value.toLocaleString("en-US")}${lowerBound ? "+" : ""}`;
}
