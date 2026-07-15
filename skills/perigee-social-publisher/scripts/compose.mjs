#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { attachGeneratedArtwork, createVisualBrief, DESIGN_SYSTEM_VERSION, IMAGE_GENERATOR } from "./lib/design-system.mjs";
import { PROJECT_ROOT, loadConfig } from "./lib/paths.mjs";
import { renderSlides } from "./lib/render.mjs";
import { atomicWriteJson, parseArgs } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
if (!args.artwork) throw new Error("Pass --artwork <path> to the image Codex generated from the creative brief.");

const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
const manifest = await readManifest(manifestPath);
const config = await loadConfig();
if (manifest.publishing?.status !== "not-published") {
  throw new Error(`Refusing to compose ${manifest.id}: publishing status is ${manifest.publishing?.status || "unknown"}.`);
}
if (!["awaiting-artwork", "blocked"].includes(manifest.status)) {
  throw new Error(`Refusing to compose ${manifest.id} from status ${manifest.status}.`);
}
if (manifest.creative?.designSystemVersion !== DESIGN_SYSTEM_VERSION) {
  throw new Error(`Manifest must use ${DESIGN_SYSTEM_VERSION}.`);
}

const briefPath = resolve(manifestPath, "..", manifest.creative.visualBrief || "creative-brief.json");
const brief = JSON.parse(await readFile(briefPath, "utf8"));
const expectedBrief = createVisualBrief(manifest, config);
if (
  brief.postId !== manifest.id
  || brief.designSystemVersion !== DESIGN_SYSTEM_VERSION
  || brief.requiredGenerator?.generatedBy !== "codex"
  || brief.requiredGenerator?.generator !== IMAGE_GENERATOR
  || brief.factsSha256 !== expectedBrief.factsSha256
  || brief.prompt !== expectedBrief.prompt
) {
  throw new Error("Creative brief no longer matches the frozen manifest data and design system.");
}
manifest.creative.artwork = await attachGeneratedArtwork({
  manifest,
  manifestPath,
  artworkPath: String(args.artwork),
  brief,
});
manifest.creative.slides = await renderSlides(manifest, resolve(manifestPath, ".."), config);
manifest.status = "draft";
await atomicWriteJson(manifestPath, manifest);

const report = await validateManifest(manifest, manifestPath, config);
manifest.validation = {
  passed: report.passed,
  validatedAt: report.validatedAt,
  report: relative(PROJECT_ROOT, resolve(manifestPath, "..", "validation.json")),
};
manifest.status = report.passed ? "validated" : "blocked";
await atomicWriteJson(resolve(manifestPath, "..", "validation.json"), report);
await atomicWriteJson(manifestPath, manifest);

console.log(JSON.stringify({
  status: manifest.status,
  postId: manifest.id,
  manifest: relative(PROJECT_ROOT, manifestPath),
  artwork: manifest.creative.artwork.file,
  slides: manifest.creative.slides.map((slide) => slide.file),
  checks: report.checks.length,
  errors: report.errors,
}, null, 2));

if (!report.passed) process.exitCode = 1;
