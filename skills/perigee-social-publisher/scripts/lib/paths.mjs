import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(here, "../../../..");
export const CONFIG_PATH = resolve(PROJECT_ROOT, "config/pipeline.json");
export const LEDGER_PATH = resolve(PROJECT_ROOT, "state/publishing-ledger.jsonl");

export function perigeeRepo() {
  const configured = process.env.PERIGEE_REPO || "../Perigee";
  return resolve(PROJECT_ROOT, configured);
}

export async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadConfig() {
  return loadJson(CONFIG_PATH);
}

export async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
