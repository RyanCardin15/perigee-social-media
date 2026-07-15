#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT, pathExists } from "./lib/paths.mjs";
import {
  atomicWritePrivateFile,
  atomicWritePrivateJson,
  parseArgs,
  sha256,
} from "./lib/utils.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.confirm) throw new Error("Token installation requires the explicit --confirm gate.");
if (process.stdin.isTTY) {
  throw new Error("Token installation requires piped stdin; interactive pasting is disabled.");
}

const chunks = [];
let tokenBuffer;
try {
  let receivedBytes = 0;
  for await (const inputChunk of process.stdin) {
    const chunk = Buffer.isBuffer(inputChunk) ? inputChunk : Buffer.from(inputChunk);
    chunks.push(chunk);
    receivedBytes += chunk.length;
    if (receivedBytes > 4096) throw new Error("Access token input is too large.");
  }

  tokenBuffer = Buffer.concat(chunks);
  const rawToken = tokenBuffer.toString("utf8");
  const token = rawToken.replace(/\r?\n$/, "");
  if (token !== token.trim() || /[\r\n]/.test(token) || !/^IG[A-Za-z0-9._~-]{38,4094}$/.test(token)) {
    throw new Error("Access token input is missing or malformed.");
  }

  const expiresInSeconds = args["expires-in"] === undefined ? 5184000 : Number(args["expires-in"]);
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 86400) {
    throw new Error("--expires-in must be a valid number of seconds greater than one day.");
  }

  const envPath = resolve(PROJECT_ROOT, ".env.local");
  if (!(await pathExists(envPath))) throw new Error("Create .env.local before installing the Instagram token.");
  const source = await readFile(envPath, "utf8");
  const tokenLine = /^INSTAGRAM_ACCESS_TOKEN=.*$/m;
  const tokenAssignments = source.match(/^INSTAGRAM_ACCESS_TOKEN=.*$/gm) || [];
  if (tokenAssignments.length !== 1) {
    throw new Error(".env.local must contain exactly one INSTAGRAM_ACCESS_TOKEN line.");
  }

  const updatedSource = source.replace(tokenLine, `INSTAGRAM_ACCESS_TOKEN=${JSON.stringify(token)}`);
  await atomicWritePrivateFile(
    envPath,
    updatedSource.endsWith("\n") ? updatedSource : `${updatedSource}\n`,
  );

  const recordedAt = new Date();
  const expiresAt = new Date(recordedAt.valueOf() + expiresInSeconds * 1000);
  const metadataPath = resolve(PROJECT_ROOT, "state/private/instagram-token.json");
  await atomicWritePrivateJson(metadataPath, {
    schemaVersion: 1,
    recordedAt: recordedAt.toISOString(),
    refreshedAt: null,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds,
    tokenSha256: sha256(token),
  });

  console.log(JSON.stringify({
    passed: true,
    recordedAt: recordedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expiresInDays: Number((expiresInSeconds / 86400).toFixed(1)),
  }, null, 2));
} finally {
  tokenBuffer?.fill(0);
  for (const chunk of chunks) chunk.fill(0);
}
