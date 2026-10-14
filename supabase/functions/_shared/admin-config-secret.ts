const ADMIN_CONFIG_SECRET_KEY = /(?:^|_)(?:API_KEY|KEY|SECRET|TOKEN|PASSWORD|PASS)$/i;

export function isAdminConfigSecretKey(key: string): boolean {
  return ADMIN_CONFIG_SECRET_KEY.test(key);
}

export function redactAdminConfigSecret(value: unknown): { value: ""; configured: boolean } {
  const configured = typeof value === "string"
    ? value.length > 0
    : value !== null && value !== undefined;
  return { value: "", configured };
}
