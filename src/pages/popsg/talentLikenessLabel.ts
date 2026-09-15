// NULL = the source gave no answer; shown as Unknown, never as No (popdam3#132).
export function talentLikenessLabel(value: boolean | null | undefined): "Yes" | "No" | "Unknown" {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}
