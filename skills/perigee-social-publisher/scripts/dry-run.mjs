#!/usr/bin/env node

import { dirname, relative, resolve, sep } from "node:path";
import { PROJECT_ROOT, loadConfig } from "./lib/paths.mjs";
import { atomicWriteJson, parseArgs } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
if (!manifestPath.startsWith(`${PROJECT_ROOT}${sep}`)) throw new Error("Manifest must be inside this repository.");

const config = await loadConfig();
const manifest = await readManifest(manifestPath);
const validation = await validateManifest(manifest, manifestPath, config);
if (!validation.passed) throw new Error(`Dry run blocked for ${manifest.id}; validation failed.`);
if (manifest.status !== "staged") throw new Error(`Dry run requires staged status; ${manifest.id} is ${manifest.status}.`);

const orderedSlides = [...manifest.creative.slides].sort((left, right) => left.order - right.order);
const location = manifest.creative.discovery?.locationTag || null;
const report = {
  schemaVersion: 1,
  postId: manifest.id,
  status: "dry-run-complete",
  completedAt: new Date().toISOString(),
  externalWritesPerformed: false,
  validationChecks: validation.checks.length,
  captionLength: manifest.creative.caption.length,
  hashtags: manifest.creative.discovery?.hashtags || [],
  localKeywords: manifest.creative.discovery?.keywords || [],
  locationTag: location,
  locationFollowUp: location?.instagramLocationId
    ? "The verified location ID would be included on the carousel container."
    : `After a real publish, add the existing Instagram place “${location?.suggestedName}” in Instagram and verify it on the live post.`,
  simulatedPayload: {
    instagram: {
      children: orderedSlides.map((slide) => ({
        order: slide.order,
        imageUrl: slide.publicUrl,
        altText: slide.altText,
        sha256: slide.sha256,
      })),
      carousel: {
        mediaType: "CAROUSEL",
        childCount: orderedSlides.length,
        caption: manifest.creative.caption,
        locationId: location?.instagramLocationId || null,
      },
    },
    facebook: {
      unpublishedPhotos: orderedSlides.map((slide) => ({
        order: slide.order,
        imageUrl: slide.publicUrl,
        altTextCustom: slide.altText,
        sha256: slide.sha256,
      })),
      feedPost: {
        message: manifest.creative.captions?.facebook || manifest.creative.caption,
        attachedMediaCount: orderedSlides.length,
        attachedMediaOrder: orderedSlides.map((slide) => slide.order),
      },
    },
  },
};
const reportPath = resolve(dirname(manifestPath), "dry-run-report.json");
await atomicWriteJson(reportPath, report);
console.log(JSON.stringify({
  postId: manifest.id,
  status: report.status,
  report: relative(PROJECT_ROOT, reportPath),
  externalWritesPerformed: false,
  locationFollowUp: report.locationFollowUp,
}, null, 2));
