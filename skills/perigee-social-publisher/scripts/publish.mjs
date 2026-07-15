#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { LEDGER_PATH, PROJECT_ROOT, loadConfig, pathExists } from "./lib/paths.mjs";
import { atomicWriteJson, loadEnvLocal, parseArgs, sha256 } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
if (!args.confirm) throw new Error("Publication requires the explicit --confirm gate.");
await loadEnvLocal(resolve(PROJECT_ROOT, ".env.local"));

const required = ["INSTAGRAM_API_VERSION", "INSTAGRAM_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN", "PUBLIC_MEDIA_BASE_URL"];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing required publication configuration: ${missing.join(", ")}.`);

const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
const config = await loadConfig();
const manifest = await readManifest(manifestPath);
const report = await validateManifest(manifest, manifestPath, config);
if (!report.passed) throw new Error(`Refusing to publish ${manifest.id}; validation failed.`);
if (manifest.status !== "staged") throw new Error(`Refusing to publish ${manifest.id}; run the staging gate first.`);
if (manifest.approval.policy === "manual" && !args["manual-approved"]) {
  throw new Error("This content type requires --manual-approved in addition to --confirm.");
}

if (await pathExists(LEDGER_PATH)) {
  const ledger = await import("node:fs/promises").then(({ readFile }) => readFile(LEDGER_PATH, "utf8"));
  if (ledger.split("\n").some((line) => line.trim() && JSON.parse(line).postId === manifest.id)) {
    throw new Error(`Post ${manifest.id} is already in the publishing ledger.`);
  }
}

for (const slide of manifest.creative.slides) {
  if (!slide.publicUrl) throw new Error(`Slide ${slide.order} has not been staged to a public URL.`);
  const response = await fetch(slide.publicUrl, { method: "HEAD", signal: AbortSignal.timeout(15000) });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.toLowerCase().includes("image/jpeg")) {
    throw new Error(`Public-media verification failed for slide ${slide.order} with HTTP ${response.status}.`);
  }
}

const version = process.env.INSTAGRAM_API_VERSION;
const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const host = `https://graph.instagram.com/${version}`;

async function graph(path, { method = "GET", fields = null } = {}) {
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  };
  if (fields) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(fields);
  }
  const response = await fetch(`${host}${path}`, options);
  const body = await response.json();
  if (!response.ok || body.error) {
    const code = body.error?.code || response.status;
    const type = body.error?.type || "instagram_api_error";
    throw new Error(`Instagram API request failed (${type}, code ${code}).`);
  }
  return body;
}

async function waitForContainer(containerId) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const status = await graph(`/${containerId}?fields=status_code`);
    if (status.status_code === "FINISHED" || status.status_code === "PUBLISHED") return;
    if (["ERROR", "EXPIRED"].includes(status.status_code)) {
      throw new Error(`Instagram rejected media container ${containerId} with status ${status.status_code}.`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  }
  throw new Error(`Instagram media container ${containerId} did not finish within 30 seconds.`);
}

const children = [];
for (const slide of manifest.creative.slides.sort((left, right) => left.order - right.order)) {
  const child = await graph(`/${accountId}/media`, {
    method: "POST",
    fields: {
      image_url: slide.publicUrl,
      is_carousel_item: "true",
      alt_text: slide.altText,
    },
  });
  if (!child.id) throw new Error(`Instagram did not return a container ID for slide ${slide.order}.`);
  await waitForContainer(child.id);
  children.push(child.id);
}

const carousel = await graph(`/${accountId}/media`, {
  method: "POST",
  fields: {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: manifest.creative.caption,
  },
});
if (!carousel.id) throw new Error("Instagram did not return a carousel container ID.");
await waitForContainer(carousel.id);
const published = await graph(`/${accountId}/media_publish`, {
  method: "POST",
  fields: { creation_id: carousel.id },
});
if (!published.id) throw new Error("Instagram did not return a published media ID.");

const live = await graph(`/${published.id}?fields=id,permalink,caption,media_type,timestamp`);
if (!live.permalink || live.id !== published.id) {
  throw new Error("Instagram publication returned no verifiable live permalink.");
}

const ledgerEntry = {
  schemaVersion: 1,
  postId: manifest.id,
  platform: "instagram",
  accountIdHash: sha256(accountId),
  mediaId: live.id,
  permalink: live.permalink,
  publishedAt: live.timestamp || new Date().toISOString(),
  manifestSha256: sha256(JSON.stringify(manifest)),
};
await mkdir(dirname(LEDGER_PATH), { recursive: true });
await appendFile(LEDGER_PATH, `${JSON.stringify(ledgerEntry)}\n`, { encoding: "utf8", mode: 0o600 });
manifest.status = "published";
manifest.publishing = {
  ...manifest.publishing,
  status: "published",
  mediaId: live.id,
  permalink: live.permalink,
  publishedAt: ledgerEntry.publishedAt,
};
await atomicWriteJson(manifestPath, manifest);

console.log(JSON.stringify({ postId: manifest.id, status: "published", mediaId: live.id, permalink: live.permalink }, null, 2));
