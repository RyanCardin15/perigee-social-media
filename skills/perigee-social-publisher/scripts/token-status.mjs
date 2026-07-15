#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT, pathExists } from "./lib/paths.mjs";
import { loadEnvLocal, sha256 } from "./lib/utils.mjs";

const envPath = resolve(PROJECT_ROOT, ".env.local");
const metadataPath = resolve(PROJECT_ROOT, "state/private/instagram-token.json");
await loadEnvLocal(envPath);
const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || "";
const metadata = await pathExists(metadataPath)
  ? JSON.parse(await readFile(metadataPath, "utf8"))
  : null;
const expiresAt = metadata ? Date.parse(metadata.expiresAt || "") : Number.NaN;
const daysRemaining = Number.isFinite(expiresAt)
  ? (expiresAt - Date.now()) / 86400000
  : null;
const tokenMatchesMetadata = Boolean(
  token && metadata?.tokenSha256 && sha256(token) === metadata.tokenSha256,
);
const status = !token
  ? "missing-token"
  : !metadata
    ? "missing-metadata"
    : !tokenMatchesMetadata
      ? "metadata-mismatch"
      : daysRemaining <= 0
        ? "expired"
        : daysRemaining <= 14
          ? "refresh-due"
          : "healthy";

console.log(JSON.stringify({
  passed: status === "healthy",
  status,
  metadataPresent: Boolean(metadata),
  tokenMatchesMetadata,
  recordedAt: metadata?.recordedAt || null,
  refreshedAt: metadata?.refreshedAt || null,
  expiresAt: metadata?.expiresAt || null,
  daysRemaining: daysRemaining === null ? null : Number(daysRemaining.toFixed(1)),
  refreshRecommended: daysRemaining !== null && daysRemaining <= 14,
}, null, 2));
if (status !== "healthy") process.exitCode = 1;
