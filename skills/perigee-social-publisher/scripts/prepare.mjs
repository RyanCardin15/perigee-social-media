#!/usr/bin/env node

import { mkdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createCreative } from "./lib/creative.mjs";
import { createGenerationBrief, DESIGN_SYSTEM_VERSION } from "./lib/design-system.mjs";
import {
  deriveMetrics,
  fetchMatchedPredictions,
  loadAlmanac,
  selectCandidate,
} from "./lib/data.mjs";
import { LEDGER_PATH, PROJECT_ROOT, loadConfig, pathExists } from "./lib/paths.mjs";
import {
  assertDateKey,
  atomicWriteJson,
  currentDateKey,
  parseArgs,
  sha256,
} from "./lib/utils.mjs";

const args = parseArgs(process.argv.slice(2));
const mode = String(args.mode || "event-watch");
const dateKey = assertDateKey(String(args.date || currentDateKey()));
const stationId = args.station ? String(args.station) : null;
if (stationId && !/^\d{7}$/.test(stationId)) throw new Error("--station must be a seven-digit NOAA station ID.");
const config = await loadConfig();
const { path: almanacPath, almanac } = await loadAlmanac();
const candidate = selectCandidate({ mode, dateKey, config, almanac, stationId });

if (!candidate) {
  console.log(JSON.stringify({ status: "quiet", mode, date: dateKey, reason: "No king-tide cluster overlaps the next seven days." }, null, 2));
  process.exit(0);
}

const { predictions, sources } = await fetchMatchedPredictions({
  row: candidate.row,
  windowStart: candidate.windowStart,
  windowHours: candidate.windowHours,
  config,
});
const metrics = deriveMetrics(predictions, candidate.row.kingTideThresholdFt);
const creative = createCreative({ candidate, dateKey, metrics, config });
const postDir = resolve(PROJECT_ROOT, "content/posts", creative.postId);
const manifestPath = resolve(postDir, "manifest.json");

if ((await pathExists(postDir)) && !args.force) {
  throw new Error(`Post ${creative.postId} already exists. Use --force only after confirming it was not published.`);
}

if (await pathExists(LEDGER_PATH)) {
  const ledger = await readFile(LEDGER_PATH, "utf8");
  if (ledger.split("\n").some((line) => line.trim() && JSON.parse(line).postId === creative.postId)) {
    throw new Error(`Post ${creative.postId} already appears in the publishing ledger.`);
  }
}

await mkdir(postDir, { recursive: true });
const manifest = {
  schemaVersion: 4,
  id: creative.postId,
  status: "awaiting-generation",
  mode,
  requestedDate: dateKey,
  generatedAt: new Date().toISOString(),
  station: {
    id: candidate.row.stationId,
    name: candidate.row.stationName,
    displayName: creative.stationName,
    stateCode: candidate.row.stateCode,
    stateName: candidate.row.stateName,
    stateSlug: candidate.row.stateSlug,
    datum: config.sources.datum,
    units: config.sources.units,
    timeZone: config.sources.timeZone,
    kingTideThresholdFt: candidate.row.kingTideThresholdFt,
    stationPath: candidate.row.stationPath,
    stateCalendarPath: candidate.row.stateCalendarPath,
    latitude: candidate.row.latitude,
    longitude: candidate.row.longitude,
  },
  window: {
    start: candidate.windowStart,
    hours: candidate.windowHours,
  },
  sources: {
    ...sources,
    almanac: {
      path: relative(PROJECT_ROOT, almanacPath),
      generatedAt: almanac.generatedAt,
      year: almanac.year,
      stationRowSha256: sha256(JSON.stringify(candidate.row)),
    },
  },
  data: {
    predictions,
    metrics,
    kingTideCluster: candidate.cluster,
  },
  creative: {
    ...creative,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    generationBrief: "generation-brief.json",
    slides: [],
  },
  approval: {
    policy: config.publishing.manualReviewTypes.includes(candidate.contentType) ? "manual" : "automatic-after-validation",
    reason: "Prediction-only content with matched NOAA and Perigee inputs.",
  },
  publishing: {
    platform: config.publishing.platform,
    format: config.publishing.format,
    accountHandle: process.env.INSTAGRAM_ACCOUNT_HANDLE || config.brand.accountHandleCandidates[0],
    status: "not-published",
    mediaId: null,
    permalink: null,
  },
  validation: null,
};

const brief = createGenerationBrief(manifest, config);
await atomicWriteJson(resolve(postDir, "generation-brief.json"), brief);
await atomicWriteJson(manifestPath, manifest);

console.log(JSON.stringify({
  status: manifest.status,
  postId: manifest.id,
  manifest: relative(PROJECT_ROOT, manifestPath),
  brief: relative(PROJECT_ROOT, resolve(postDir, "generation-brief.json")),
  next: `Generate all five complete slide images with Codex built-in image generation from the five brief prompts, inspect each result, then run npm run social:attach -- --manifest ${relative(PROJECT_ROOT, manifestPath)} --slide-1 <path> --slide-2 <path> --slide-3 <path> --slide-4 <path> --slide-5 <path> --confirm-reviewed.`,
}, null, 2));
