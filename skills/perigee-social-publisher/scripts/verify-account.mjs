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
  "FACEBOOK_GRAPH_API_VERSION",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_NAME",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing required Meta account configuration: ${missing.join(", ")}.`);

const instagramVersion = process.env.INSTAGRAM_API_VERSION;
const instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
const expectedInstagramHandle = process.env.INSTAGRAM_ACCOUNT_HANDLE.trim().replace(/^@/, "").toLowerCase();
const instagramToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const facebookVersion = process.env.FACEBOOK_GRAPH_API_VERSION;
const facebookPageId = process.env.FACEBOOK_PAGE_ID;
const expectedFacebookPageName = process.env.FACEBOOK_PAGE_NAME.trim();
const expectedFacebookHandle = String(process.env.FACEBOOK_PAGE_HANDLE || "").trim().replace(/^@/, "").toLowerCase();
const facebookToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
if (!/^v\d+\.\d+$/.test(instagramVersion)) throw new Error("INSTAGRAM_API_VERSION is invalid.");
if (!/^\d+$/.test(instagramAccountId)) throw new Error("INSTAGRAM_ACCOUNT_ID is invalid.");
if (!/^v\d+\.\d+$/.test(facebookVersion)) throw new Error("FACEBOOK_GRAPH_API_VERSION is invalid.");
if (!/^\d+$/.test(facebookPageId)) throw new Error("FACEBOOK_PAGE_ID is invalid.");

let instagramGraphHost = `https://graph.instagram.com/${instagramVersion}`;
let facebookGraphHost = `https://graph.facebook.com/${facebookVersion}`;
if (process.env.PERIGEE_SOCIAL_TEST_MODE === "1") {
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  const instagramOverride = new URL(process.env.PERIGEE_SOCIAL_TEST_GRAPH_BASE_URL || "");
  const facebookOverride = new URL(process.env.PERIGEE_SOCIAL_TEST_FACEBOOK_GRAPH_BASE_URL || "");
  if (!loopbackHosts.has(instagramOverride.hostname)) throw new Error("The Instagram test Graph API override must use a loopback host.");
  if (!loopbackHosts.has(facebookOverride.hostname)) throw new Error("The Facebook test Graph API override must use a loopback host.");
  instagramGraphHost = instagramOverride.toString().replace(/\/$/, "");
  facebookGraphHost = facebookOverride.toString().replace(/\/$/, "");
}

async function graph(host, path, token, platform) {
  const response = await fetch(`${host}${path}`, {
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
    const type = body.error?.type || `${platform}_api_error`;
    throw new Error(`${platform} account verification failed (${type}, code ${code}).`);
  }
  return body;
}

const [instagramProfile, quotaResponse, facebookPage] = await Promise.all([
  graph(instagramGraphHost, "/me?fields=user_id,username,account_type", instagramToken, "Instagram"),
  graph(
    instagramGraphHost,
    `/${instagramAccountId}/content_publishing_limit?fields=quota_usage,config`,
    instagramToken,
    "Instagram",
  ),
  graph(
    facebookGraphHost,
    `/${facebookPageId}?fields=${encodeURIComponent("id,name,username,link")}`,
    facebookToken,
    "Facebook",
  ),
]);

const quota = quotaResponse.data?.[0] || quotaResponse;
const usage = Number(quota.quota_usage);
const total = Number(quota.config?.quota_total);
const instagramChecks = {
  accountIdMatches: String(instagramProfile.user_id || "") === instagramAccountId,
  usernameMatches: String(instagramProfile.username || "").toLowerCase() === expectedInstagramHandle,
  businessAccount: String(instagramProfile.account_type || "").toLowerCase() === "business",
  quotaValid: Number.isFinite(usage) && Number.isFinite(total) && total > 0 && usage < total,
};
const facebookChecks = {
  pageIdMatches: String(facebookPage.id || "") === facebookPageId,
  pageNameMatches: String(facebookPage.name || "").trim() === expectedFacebookPageName,
  pageHandleMatches: !expectedFacebookHandle || String(facebookPage.username || "").toLowerCase() === expectedFacebookHandle,
  publicLinkPresent: Boolean(facebookPage.link),
};
const passed = [...Object.values(instagramChecks), ...Object.values(facebookChecks)].every(Boolean);
console.log(JSON.stringify({
  passed,
  instagram: {
    username: instagramProfile.username || null,
    accountType: instagramProfile.account_type || null,
    checks: instagramChecks,
    quota: Number.isFinite(usage) && Number.isFinite(total) ? { usage, total, remaining: total - usage } : null,
  },
  facebook: {
    pageName: facebookPage.name || null,
    username: facebookPage.username || null,
    link: facebookPage.link || null,
    checks: facebookChecks,
  },
}, null, 2));
if (!passed) process.exitCode = 1;
