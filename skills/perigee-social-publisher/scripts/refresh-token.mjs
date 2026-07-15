#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT, pathExists } from "./lib/paths.mjs";
import {
  atomicWritePrivateFile,
  atomicWritePrivateJson,
  loadEnvLocal,
  parseArgs,
  sha256,
} from "./lib/utils.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.confirm) throw new Error("Token refresh requires the explicit --confirm gate.");

const envPath = resolve(PROJECT_ROOT, ".env.local");
if (!(await pathExists(envPath))) throw new Error("Create .env.local before refreshing the Instagram token.");
await loadEnvLocal(envPath);
const currentToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
if (!currentToken) throw new Error("INSTAGRAM_ACCESS_TOKEN is missing from .env.local.");

const testMode = process.env.PERIGEE_SOCIAL_TEST_MODE === "1";
let endpoint = new URL("https://graph.instagram.com/refresh_access_token");
if (testMode) {
  const override = process.env.PERIGEE_SOCIAL_TEST_REFRESH_URL;
  if (!override) throw new Error("Test mode requires PERIGEE_SOCIAL_TEST_REFRESH_URL.");
  endpoint = new URL(override);
  if (!new Set(["127.0.0.1", "::1", "localhost"]).has(endpoint.hostname)) {
    throw new Error("The test token-refresh endpoint must use a loopback host.");
  }
}
endpoint.searchParams.set("grant_type", "ig_refresh_token");
endpoint.searchParams.set("access_token", currentToken);

const response = await fetch(endpoint, { signal: AbortSignal.timeout(30000), redirect: "error" });
let body = {};
try {
  body = await response.json();
} catch {
  body = {};
}
if (!response.ok || body.error) {
  const code = body.error?.code || response.status;
  const type = body.error?.type || "instagram_token_refresh_error";
  throw new Error(`Instagram token refresh failed (${type}, code ${code}).`);
}
const refreshedToken = String(body.access_token || "").trim();
const expiresInSeconds = Number(body.expires_in);
if (!refreshedToken || /[\r\n]/.test(refreshedToken)) {
  throw new Error("Instagram token refresh returned an invalid access token.");
}
if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 86400) {
  throw new Error("Instagram token refresh returned an invalid expiration interval.");
}

const source = await readFile(envPath, "utf8");
const replacement = `INSTAGRAM_ACCESS_TOKEN=${JSON.stringify(refreshedToken)}`;
const tokenLine = /^INSTAGRAM_ACCESS_TOKEN=.*$/m;
const tokenAssignments = source.match(/^INSTAGRAM_ACCESS_TOKEN=.*$/gm) || [];
if (tokenAssignments.length !== 1) {
  throw new Error(".env.local must contain exactly one INSTAGRAM_ACCESS_TOKEN line.");
}
const updatedSource = source.replace(tokenLine, replacement);
await atomicWritePrivateFile(
  envPath,
  updatedSource.endsWith("\n") ? updatedSource : `${updatedSource}\n`,
);

const refreshedAt = new Date();
const expiresAt = new Date(refreshedAt.valueOf() + expiresInSeconds * 1000);
const metadataPath = resolve(PROJECT_ROOT, "state/private/instagram-token.json");
await atomicWritePrivateJson(metadataPath, {
  schemaVersion: 1,
  refreshedAt: refreshedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  expiresInSeconds,
  tokenSha256: sha256(refreshedToken),
});

console.log(JSON.stringify({
  passed: true,
  refreshedAt: refreshedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  expiresInDays: Number((expiresInSeconds / 86400).toFixed(1)),
  tokenChanged: refreshedToken !== currentToken,
}, null, 2));
