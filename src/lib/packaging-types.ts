export const PACKAGING_TYPE_EDITOR_EMAIL = "apinilla@popcre.com";

export type PackagingTypeStatus = "active" | "inactive";

export function canManagePackagingTypes(email: string | null | undefined, isAdmin: boolean): boolean {
  return isAdmin || email?.trim().toLowerCase() === PACKAGING_TYPE_EDITOR_EMAIL;
}

export function cleanPackagingTypeInput(name: string, code: string) {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const cleanCode = code.trim().replace(/\s+/g, " ").toUpperCase();

  return {
    name: cleanName,
    code: cleanCode || null,
  };
}
