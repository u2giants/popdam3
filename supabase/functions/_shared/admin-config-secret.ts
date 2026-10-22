const ADMIN_CONFIG_SECRET_KEY = /(?:^|_)(?:API_KEY|KEY|SECRET|TOKEN|PASSWORD|PASS)$/i;

export function isAdminConfigSecretKey(key: string): boolean {
  return ADMIN_CONFIG_SECRET_KEY.test(key);
}

export function redactAdminConfigSecret(value: unknown): { value: ""; configured: boolean } {
  const configured = typeof value === "string" ? value.length > 0 : value !== null && value !== undefined;
  return { value: "", configured };
}

export function redactAdminConfigValues(rows: readonly { key: string; value: unknown }[] | null | undefined): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    config[row.key] = isAdminConfigSecretKey(row.key) ? redactAdminConfigSecret(row.value) : row.value;
  }
  return config;
}
