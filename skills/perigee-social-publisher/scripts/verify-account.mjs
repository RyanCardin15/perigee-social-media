#!/usr/bin/env node

import { resolve } from "node:path";
import { PROJECT_ROOT } from "./lib/paths.mjs";
import { loadEnvLocal } from "./lib/utils.mjs";

await loadEnvLocal(resolve(PROJECT_ROOT, ".env.local"));
const required = [
  "INSTAGRAM_API_VERSION",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_ACCOUNT_HANDLE",
  "INSTAGRAM_ACCESS_TOKEN",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing required Instagram configuration: ${missing.join(", ")}.`);

const version = process.env.INSTAGRAM_API_VERSION;
const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
const expectedHandle = process.env.INSTAGRAM_ACCOUNT_HANDLE.trim().replace(/^@/, "").toLowerCase();
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
if (!/^v\d+\.\d+$/.test(version)) throw new Error("INSTAGRAM_API_VERSION is invalid.");
if (!/^\d+$/.test(accountId)) throw new Error("INSTAGRAM_ACCOUNT_ID is invalid.");
let graphHost = `https://graph.instagram.com/${version}`;
if (process.env.PERIGEE_SOCIAL_TEST_MODE === "1") {
  const override = new URL(process.env.PERIGEE_SOCIAL_TEST_GRAPH_BASE_URL || "");
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(override.hostname)) {
    throw new Error("The test Graph API override must use a loopback host.");
  }
  graphHost = override.toString().replace(/\/$/, "");
}

async function graph(path) {
  const response = await fetch(`${graphHost}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok || body.error) {
    const code = body.error?.code || response.status;
    const type = body.error?.type || "instagram_api_error";
    throw new Error(`Instagram account verification failed (${type}, code ${code}).`);
  }
  return body;
}

const profile = await graph("/me?fields=user_id,username,account_type");
const quotaResponse = await graph(`/${accountId}/content_publishing_limit?fields=quota_usage,config`);
const quota = quotaResponse.data?.[0] || quotaResponse;
const usage = Number(quota.quota_usage);
const total = Number(quota.config?.quota_total);
const checks = {
  accountIdMatches: String(profile.user_id || "") === accountId,
  usernameMatches: String(profile.username || "").toLowerCase() === expectedHandle,
  businessAccount: String(profile.account_type || "").toLowerCase() === "business",
  quotaValid: Number.isFinite(usage) && Number.isFinite(total) && total > 0 && usage < total,
};
const passed = Object.values(checks).every(Boolean);
console.log(JSON.stringify({
  passed,
  username: profile.username || null,
  accountType: profile.account_type || null,
  checks,
  quota: Number.isFinite(usage) && Number.isFinite(total) ? { usage, total, remaining: total - usage } : null,
}, null, 2));
if (!passed) process.exitCode = 1;
