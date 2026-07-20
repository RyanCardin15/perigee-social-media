#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT, pathExists } from "./lib/paths.mjs";
import { atomicWritePrivateFile, parseArgs } from "./lib/utils.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.confirm) throw new Error("Facebook Page configuration requires the explicit --confirm gate.");
const pageId = String(args["page-id"] || "").trim();
const pageName = String(args["page-name"] || "").trim();
const pageHandle = String(args["page-handle"] || "").trim().replace(/^@/, "").toLowerCase();
if (!/^\d+$/.test(pageId)) throw new Error("--page-id must contain only digits.");
if (pageName.length < 3 || /[\r\n]/.test(pageName)) throw new Error("--page-name is invalid.");
if (pageHandle && !/^[a-z0-9.]{5,50}$/.test(pageHandle)) throw new Error("--page-handle is invalid.");

const envPath = resolve(PROJECT_ROOT, ".env.local");
if (!(await pathExists(envPath))) throw new Error("Create .env.local before configuring the Facebook Page.");
let source = await readFile(envPath, "utf8");

const values = {
  FACEBOOK_GRAPH_API_VERSION: "v25.0",
  FACEBOOK_PAGE_ID: pageId,
  FACEBOOK_PAGE_NAME: pageName,
  FACEBOOK_PAGE_HANDLE: pageHandle,
  FACEBOOK_PAGE_ACCESS_TOKEN: "",
};
for (const [name, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${name}=.*$`, "gm");
  const assignments = source.match(pattern) || [];
  if (assignments.length > 1) throw new Error(`.env.local contains more than one ${name} line.`);
  if (assignments.length === 1) {
    if (name !== "FACEBOOK_PAGE_ACCESS_TOKEN" || !assignments[0].slice(name.length + 1).trim()) {
      source = source.replace(pattern, `${name}=${value}`);
    }
  } else {
    source = `${source.trimEnd()}\n${name}=${value}\n`;
  }
}
await atomicWritePrivateFile(envPath, source.endsWith("\n") ? source : `${source}\n`);
console.log(JSON.stringify({ passed: true, pageIdConfigured: true, pageName, pageHandle: pageHandle || null }, null, 2));
