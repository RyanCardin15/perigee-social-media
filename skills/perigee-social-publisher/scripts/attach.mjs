#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  attachGeneratedSlides,
  createGenerationBrief,
  DESIGN_SYSTEM_VERSION,
  IMAGE_GENERATOR,
} from "./lib/design-system.mjs";
import { PROJECT_ROOT, loadConfig } from "./lib/paths.mjs";
import { atomicWriteJson, parseArgs } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
if (args["confirm-reviewed"] !== true) {
  throw new Error("Pass --confirm-reviewed only after Codex has visually checked every slide against its exact prompt and data.");
}
const slidePaths = [1, 2, 3, 4, 5].map((order) => args[`slide-${order}`]);
if (slidePaths.some((path) => !path)) {
  throw new Error("Pass all five generated image outputs with --slide-1 through --slide-5.");
}

const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
const manifest = await readManifest(manifestPath);
const config = await loadConfig();
if (manifest.publishing?.status !== "not-published") {
  throw new Error(`Refusing to attach images to ${manifest.id}: publishing status is ${manifest.publishing?.status || "unknown"}.`);
}
if (!["awaiting-generation", "blocked"].includes(manifest.status)) {
  throw new Error(`Refusing to attach images to ${manifest.id} from status ${manifest.status}.`);
}
if (![3, 4].includes(manifest.schemaVersion) || manifest.creative?.designSystemVersion !== DESIGN_SYSTEM_VERSION) {
  throw new Error(`Manifest must use schema 3 or 4 and ${DESIGN_SYSTEM_VERSION}.`);
}

const briefPath = resolve(manifestPath, "..", manifest.creative.generationBrief || "generation-brief.json");
const brief = JSON.parse(await readFile(briefPath, "utf8"));
const expectedBrief = createGenerationBrief(manifest, config);
if (
  brief.postId !== manifest.id
  || brief.designSystemVersion !== DESIGN_SYSTEM_VERSION
  || brief.requiredGenerator?.generatedBy !== "codex"
  || brief.requiredGenerator?.generator !== IMAGE_GENERATOR
  || brief.requiredGenerator?.mode !== "built-in"
  || brief.factsSha256 !== expectedBrief.factsSha256
  || JSON.stringify(brief.slides.map(({ prompt }) => prompt)) !== JSON.stringify(expectedBrief.slides.map(({ prompt }) => prompt))
) {
  throw new Error("Generation brief no longer matches the frozen manifest data and design system.");
}

manifest.creative.slides = await attachGeneratedSlides({
  manifest,
  manifestPath,
  slidePaths: slidePaths.map(String),
  brief,
  config,
});
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
  slides: manifest.creative.slides.map((slide) => slide.file),
  checks: report.checks.length,
  errors: report.errors,
}, null, 2));

if (!report.passed) process.exitCode = 1;
