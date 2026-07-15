#!/usr/bin/env node

import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PROJECT_ROOT } from "./lib/paths.mjs";
import { atomicWriteJson, loadEnvLocal, parseArgs, sha256 } from "./lib/utils.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.confirm) throw new Error("Token metadata recording requires the explicit --confirm gate.");
await loadEnvLocal(resolve(PROJECT_ROOT, ".env.local"));
const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN is missing from .env.local.");
const expiresInSeconds = args["expires-in"] === undefined ? 5184000 : Number(args["expires-in"]);
if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 86400) {
  throw new Error("--expires-in must be a valid number of seconds greater than one day.");
}

const recordedAt = new Date();
const expiresAt = new Date(recordedAt.valueOf() + expiresInSeconds * 1000);
const metadataPath = resolve(PROJECT_ROOT, "state/private/instagram-token.json");
await mkdir(dirname(metadataPath), { recursive: true });
await atomicWriteJson(metadataPath, {
  schemaVersion: 1,
  recordedAt: recordedAt.toISOString(),
  refreshedAt: null,
  expiresAt: expiresAt.toISOString(),
  expiresInSeconds,
  tokenSha256: sha256(token),
});
await chmod(metadataPath, 0o600);

console.log(JSON.stringify({
  passed: true,
  recordedAt: recordedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  expiresInDays: Number((expiresInSeconds / 86400).toFixed(1)),
}, null, 2));
