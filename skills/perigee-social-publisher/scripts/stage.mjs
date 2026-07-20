#!/usr/bin/env node

import { basename, relative, resolve } from "node:path";
import { copyFile, mkdir } from "node:fs/promises";
import { PROJECT_ROOT, loadConfig } from "./lib/paths.mjs";
import { atomicWriteJson, loadEnvLocal, parseArgs } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
await loadEnvLocal(resolve(PROJECT_ROOT, ".env.local"));
const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
const config = await loadConfig();
const manifest = await readManifest(manifestPath);
const report = await validateManifest(manifest, manifestPath, config);
if (!report.passed) throw new Error(`Refusing to stage ${manifest.id}; validation failed.`);

const publicDir = resolve(PROJECT_ROOT, "public/posts", manifest.id);
await mkdir(publicDir, { recursive: true });
const base = String(
  process.env.PUBLIC_MEDIA_BASE_URL ||
    "https://raw.githubusercontent.com/RyanCardin15/perigee-social-media/main/public/posts",
).replace(/\/$/, "");

for (const slide of manifest.creative.slides) {
  const name = basename(slide.file);
  await copyFile(resolve(PROJECT_ROOT, slide.file), resolve(publicDir, name));
  slide.publicUrl = `${base}/${encodeURIComponent(manifest.id)}/${encodeURIComponent(name)}`;
}

const publicManifest = {
  schemaVersion: 1,
  id: manifest.id,
  contentType: manifest.creative.contentType,
  station: manifest.station,
  window: manifest.window,
  sourceUrls: [manifest.sources.noaa.url, manifest.sources.perigee.url],
  ctaUrl: manifest.creative.ctaUrl,
  ctaUrls: manifest.creative.ctaUrls || { instagram: manifest.creative.ctaUrl },
  captions: manifest.creative.captions || { instagram: manifest.creative.caption },
  discovery: manifest.creative.discovery || null,
  slides: manifest.creative.slides.map(({ order, publicUrl, altText, sha256 }) => ({ order, publicUrl, altText, sha256 })),
};
await atomicWriteJson(resolve(publicDir, "manifest.public.json"), publicManifest);
manifest.status = "staged";
manifest.publishing.status = "staged-not-published";
manifest.publishing.stagedAt = new Date().toISOString();
await atomicWriteJson(manifestPath, manifest);

console.log(JSON.stringify({
  postId: manifest.id,
  status: manifest.status,
  publicDirectory: relative(PROJECT_ROOT, publicDir),
  publicUrls: manifest.creative.slides.map((slide) => slide.publicUrl),
}, null, 2));
