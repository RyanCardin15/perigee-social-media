#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (!args.includes("--confirm")) throw new Error("Publication requires the explicit --confirm gate.");

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));

async function run(scriptName) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [resolve(scriptsDirectory, scriptName), ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectRun(new Error(`${scriptName} stopped after signal ${signal}.`));
      } else if (code !== 0) {
        rejectRun(new Error(`${scriptName} failed with exit code ${code}.`));
      } else {
        resolveRun();
      }
    });
  });
}

await run("publish.mjs");
await run("publish-facebook.mjs");
