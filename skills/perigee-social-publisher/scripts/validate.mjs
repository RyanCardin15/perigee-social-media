#!/usr/bin/env node

import { dirname, relative, resolve } from "node:path";
import { PROJECT_ROOT, loadConfig } from "./lib/paths.mjs";
import { atomicWriteJson, parseArgs } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
const config = await loadConfig();
const manifest = await readManifest(manifestPath);
const report = await validateManifest(manifest, manifestPath, config);
const reportPath = resolve(dirname(manifestPath), "validation.json");

manifest.validation = {
  passed: report.passed,
  validatedAt: report.validatedAt,
  report: relative(PROJECT_ROOT, reportPath),
};
if (!report.passed) manifest.status = "blocked";
else if (!["staged", "published"].includes(manifest.status)) manifest.status = "validated";

await atomicWriteJson(reportPath, report);
await atomicWriteJson(manifestPath, manifest);
console.log(JSON.stringify({ postId: manifest.id, passed: report.passed, checks: report.checks.length, errors: report.errors }, null, 2));
if (!report.passed) process.exitCode = 1;
