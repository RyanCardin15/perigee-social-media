#!/usr/bin/env node

import { resolve } from "node:path";
import { PROJECT_ROOT } from "./lib/paths.mjs";
import { loadEnvLocal } from "./lib/utils.mjs";

await loadEnvLocal(resolve(PROJECT_ROOT, ".env.local"));
const required = [
  "INSTAGRAM_API_VERSION",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_ACCOUNT_HANDLE",
  "INSTAGRAM_ACCESS_TOKEN",
  "FACEBOOK_GRAPH_API_VERSION",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_NAME",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
  "PUBLIC_MEDIA_BASE_URL",
];
const presence = Object.fromEntries(required.map((name) => [name, Boolean(process.env[name]?.trim())]));
let publicHost = null;
try {
  publicHost = new URL(process.env.PUBLIC_MEDIA_BASE_URL || "").host || null;
} catch {
  publicHost = null;
}
const passed = Object.values(presence).every(Boolean) && Boolean(publicHost);
console.log(JSON.stringify({ passed, presence, publicHost }, null, 2));
if (!passed) process.exitCode = 1;
