import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const [rawKey, inlineValue] = part.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[rawKey] = argv[index + 1];
      index += 1;
    } else {
      args[rawKey] = true;
    }
  }
  return args;
}

export function assertDateKey(value, label = "date") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
  return value;
}

export function currentDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(dateKey, count) {
  const date = new Date(`${assertDateKey(dateKey)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function compactDate(dateKey) {
  return assertDateKey(dateKey).replaceAll("-", "");
}

export function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

export async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "PerigeeSocial/1.0 (https://perigeetides.com)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status} for ${new URL(url).host}.`);
  }
  return response.json();
}

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export async function atomicWritePrivateFile(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fileHandle;
  try {
    fileHandle = await open(temporaryPath, "wx", 0o600);
    await fileHandle.writeFile(value);
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await rename(temporaryPath, path);
    await chmod(path, 0o600);

    const directoryHandle = await open(dirname(path), "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await fileHandle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export async function atomicWritePrivateJson(path, value) {
  await atomicWritePrivateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadEnvLocal(path) {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function formatStationLocal(value) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(value || "");
  if (!match) throw new Error(`Invalid station-local timestamp: ${value}`);
  const [, dateKey, rawHour, minute] = match;
  const hour = Number(rawHour);
  const displayHour = hour % 12 || 12;
  const period = hour < 12 ? "AM" : "PM";
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00Z`));
  return { dateKey, dateLabel, timeLabel: `${displayHour}:${minute} ${period}` };
}

export function titleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bUscg\b/g, "USCG")
    .replace(/\bUs\b/g, "US");
}
