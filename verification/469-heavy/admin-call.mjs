#!/usr/bin/env node
// Admin-api caller for #469 heavy live-proof probes. No secrets in this file:
// DAM_ADMIN_PASSWORD is injected at run time via 1Password op_run (op:// reference).
// Usage: node admin-call.mjs <action> ['{"json":"body"}']
// Prints the admin-api response JSON (never prints the access token).

const SUPABASE_URL = "https://qsllyeztdwjgirsysgai.supabase.co";
const ANON_KEY = "sb_publishable_DzKBYH1jmWYDuA3ONUrPQQ_0EFEUSbE";
const EMAIL = "ai-admin@designflow.app";

const action = process.argv[2];
if (!action) {
  console.error("usage: node admin-call.mjs <action> [jsonBody]");
  process.exit(2);
}
const bodyExtra = process.argv[3] ? JSON.parse(process.argv[3]) : {};

const password = process.env.DAM_ADMIN_PASSWORD;
if (!password) {
  console.error("DAM_ADMIN_PASSWORD not set");
  process.exit(2);
}

const grant = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: ANON_KEY },
  body: JSON.stringify({ email: EMAIL, password }),
});
const grantJson = await grant.json();
if (!grant.ok || !grantJson.access_token) {
  console.error("password grant failed", grant.status, grantJson.error_description || grantJson.error || grantJson.msg || "");
  process.exit(1);
}

const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${grantJson.access_token}`,
    apikey: ANON_KEY,
  },
  body: JSON.stringify({ action, ...bodyExtra }),
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
