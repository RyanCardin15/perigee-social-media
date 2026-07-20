#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT, pathExists } from "./lib/paths.mjs";
import { atomicWritePrivateFile, atomicWritePrivateJson, parseArgs, sha256 } from "./lib/utils.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.confirm) throw new Error("Facebook token installation requires the explicit --confirm gate.");
if (process.stdin.isTTY) throw new Error("Facebook token installation requires piped stdin; interactive pasting is disabled.");

function parseExpiration(value, label, { allowNever = false } = {}) {
  if (allowNever && value === "never") return { kind: "never", value: null };
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new Error(`${label} must be a future ISO-8601 timestamp${allowNever ? ' or "never"' : ""}.`);
  }
  return { kind: "timestamp", value: new Date(timestamp).toISOString() };
}

const tokenExpiration = parseExpiration(args["expires-at"], "--expires-at", { allowNever: true });
const dataAccessExpiration = parseExpiration(args["data-access-expires-at"], "--data-access-expires-at");

const chunks = [];
let tokenBuffer;
try {
  let receivedBytes = 0;
  for await (const inputChunk of process.stdin) {
    const chunk = Buffer.isBuffer(inputChunk) ? inputChunk : Buffer.from(inputChunk);
    chunks.push(chunk);
    receivedBytes += chunk.length;
    if (receivedBytes > 4096) throw new Error("Facebook access token input is too large.");
  }
  tokenBuffer = Buffer.concat(chunks);
  const token = tokenBuffer.toString("utf8").replace(/\r?\n$/, "");
  if (token !== token.trim() || /[\r\n]/.test(token) || !/^EAA[A-Za-z0-9._~-]{20,4094}$/.test(token)) {
    throw new Error("Facebook Page access token input is missing or malformed.");
  }

  const envPath = resolve(PROJECT_ROOT, ".env.local");
  if (!(await pathExists(envPath))) throw new Error("Create .env.local before installing the Facebook Page token.");
  const source = await readFile(envPath, "utf8");
  const tokenLine = /^FACEBOOK_PAGE_ACCESS_TOKEN=.*$/m;
  const assignments = source.match(/^FACEBOOK_PAGE_ACCESS_TOKEN=.*$/gm) || [];
  if (assignments.length !== 1) throw new Error(".env.local must contain exactly one FACEBOOK_PAGE_ACCESS_TOKEN line.");
  const updatedSource = source.replace(tokenLine, `FACEBOOK_PAGE_ACCESS_TOKEN=${JSON.stringify(token)}`);
  await atomicWritePrivateFile(envPath, updatedSource.endsWith("\n") ? updatedSource : `${updatedSource}\n`);

  const recordedAt = new Date().toISOString();
  await atomicWritePrivateJson(resolve(PROJECT_ROOT, "state/private/facebook-page-token.json"), {
    schemaVersion: 2,
    tokenType: "page-access-token",
    recordedAt,
    expirationKind: tokenExpiration.kind,
    expiresAt: tokenExpiration.value,
    dataAccessExpiresAt: dataAccessExpiration.value,
    tokenSha256: sha256(token),
  });
  console.log(JSON.stringify({
    passed: true,
    tokenType: "page-access-token",
    recordedAt,
    expirationKind: tokenExpiration.kind,
    expiresAt: tokenExpiration.value,
    dataAccessExpiresAt: dataAccessExpiration.value,
  }, null, 2));
} finally {
  tokenBuffer?.fill(0);
  for (const chunk of chunks) chunk.fill(0);
}
