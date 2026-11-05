/** Bound each PostgREST request to the rows still belonging to this export page. */
export function exportRange(offset: number, remaining: number, maximum = 1000): [number, number] {
  return [offset, offset + Math.min(maximum, remaining) - 1];
}
