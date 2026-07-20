#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT, pathExists } from "./lib/paths.mjs";
import { loadEnvLocal, sha256 } from "./lib/utils.mjs";

const envPath = resolve(PROJECT_ROOT, ".env.local");
const metadataPath = resolve(PROJECT_ROOT, "state/private/facebook-page-token.json");
await loadEnvLocal(envPath);

const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim() || "";
const metadata = await pathExists(metadataPath)
  ? JSON.parse(await readFile(metadataPath, "utf8"))
  : null;
const tokenMatchesMetadata = Boolean(
  token && metadata?.tokenSha256 && sha256(token) === metadata.tokenSha256,
);
const now = Date.now();
const expiresAt = metadata?.expirationKind === "never"
  ? Number.POSITIVE_INFINITY
  : Date.parse(metadata?.expiresAt || "");
const dataAccessExpiresAt = Date.parse(metadata?.dataAccessExpiresAt || "");
const daysRemaining = Number.isFinite(expiresAt) ? (expiresAt - now) / 86400000 : null;
const dataAccessDaysRemaining = Number.isFinite(dataAccessExpiresAt)
  ? (dataAccessExpiresAt - now) / 86400000
  : null;

const status = !token
  ? "missing-token"
  : !metadata
    ? "missing-metadata"
    : !tokenMatchesMetadata
      ? "metadata-mismatch"
      : !["never", "timestamp"].includes(metadata.expirationKind)
        ? "unknown-expiration"
        : metadata.expirationKind === "timestamp" && (!Number.isFinite(expiresAt) || expiresAt <= now)
          ? "expired"
          : !Number.isFinite(dataAccessExpiresAt)
            ? "missing-data-access-expiration"
            : dataAccessExpiresAt <= now
              ? "data-access-expired"
              : (metadata.expirationKind === "timestamp" && daysRemaining <= 14) || dataAccessDaysRemaining <= 14
                ? "refresh-due"
                : "healthy";

console.log(JSON.stringify({
  passed: status === "healthy",
  status,
  metadataPresent: Boolean(metadata),
  tokenMatchesMetadata,
  recordedAt: metadata?.recordedAt || null,
  expirationKind: metadata?.expirationKind || null,
  expiresAt: metadata?.expiresAt || null,
  daysRemaining: daysRemaining === null ? null : Number(daysRemaining.toFixed(1)),
  dataAccessExpiresAt: metadata?.dataAccessExpiresAt || null,
  dataAccessDaysRemaining: dataAccessDaysRemaining === null
    ? null
    : Number(dataAccessDaysRemaining.toFixed(1)),
  refreshRecommended: status === "refresh-due",
}, null, 2));
if (status !== "healthy") process.exitCode = 1;
