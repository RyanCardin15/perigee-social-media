import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function runNode(args, options = {}) {
  const { input, ...spawnOptions } = options;
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, spawnOptions);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function envSource(accountId, token = "") {
  return [
    "# Preserve comments and unrelated settings byte-for-byte.",
    "INSTAGRAM_API_VERSION=v25.0",
    `INSTAGRAM_ACCOUNT_ID=${accountId}`,
    "INSTAGRAM_ACCOUNT_HANDLE=perigeetides",
    `INSTAGRAM_ACCESS_TOKEN=${token}`,
    "PUBLIC_MEDIA_BASE_URL=https://example.com/posts",
    "UNRELATED_SETTING=preserve-me",
    "",
  ].join("\n");
}

async function temporaryFiles(root, baseName = ".env.local") {
  return (await readdir(root)).filter((name) => name.startsWith(`${baseName}.`) && name.endsWith(".tmp"));
}

test("private atomic writes use restrictive permissions and clean failed temporary files", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "perigee-private-write-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const utilsUrl = pathToFileURL(
    resolve(repoRoot, "skills/perigee-social-publisher/scripts/lib/utils.mjs"),
  );
  const { atomicWritePrivateFile } = await import(`${utilsUrl.href}?test=${Date.now()}`);

  const privatePath = resolve(root, "private/token.env");
  await atomicWritePrivateFile(privatePath, "private-value\n");
  assert.equal(await readFile(privatePath, "utf8"), "private-value\n");
  assert.equal((await stat(privatePath)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(privatePath))).mode & 0o777, 0o700);

  const blockedPath = resolve(root, "blocked-target");
  await mkdir(blockedPath);
  await writeFile(resolve(blockedPath, "keep"), "occupied");
  await assert.rejects(atomicWritePrivateFile(blockedPath, "never-persist"));
  assert.deepEqual(await temporaryFiles(root, "blocked-target"), []);
  assert.equal(await readFile(resolve(blockedPath, "keep"), "utf8"), "occupied");
});

test("token installation rejects unsafe input without changing private state", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "perigee-social-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(repoRoot, "skills"), resolve(root, "skills"), { recursive: true });

  const accountId = "17841400000000000";
  const token = `IG${"a".repeat(62)}`;
  const otherToken = `IG${"b".repeat(62)}`;
  const envPath = resolve(root, ".env.local");
  const originalSource = envSource(accountId);
  const installScript = resolve(root, "skills/perigee-social-publisher/scripts/install-token.mjs");

  const cases = [
    { name: "unconfirmed", args: [], input: token, message: /explicit --confirm gate/ },
    { name: "empty", args: ["--confirm"], input: "", message: /missing or malformed/ },
    { name: "leading whitespace", args: ["--confirm"], input: ` ${token}`, message: /missing or malformed/ },
    { name: "multiple lines", args: ["--confirm"], input: `${token}\n${otherToken}`, message: /missing or malformed/ },
    { name: "oversized", args: ["--confirm"], input: `IG${"x".repeat(4095)}`, message: /too large/ },
    {
      name: "invalid expiry",
      args: ["--confirm", "--expires-in", "100"],
      input: token,
      message: /greater than one day/,
    },
  ];

  for (const entry of cases) {
    await writeFile(envPath, originalSource, { mode: 0o600 });
    const result = await runNode([installScript, ...entry.args], {
      cwd: root,
      env: process.env,
      input: entry.input,
    });
    assert.notEqual(result.code, 0, entry.name);
    assert.match(result.stderr, entry.message, entry.name);
    assert.equal(await readFile(envPath, "utf8"), originalSource, entry.name);
    for (const secret of [token, otherToken, entry.input.slice(0, 48)]) {
      if (secret) assert.equal((result.stdout + result.stderr).includes(secret), false, entry.name);
    }
    assert.deepEqual(await temporaryFiles(root), [], entry.name);
  }

  const invalidAssignments = [
    originalSource.replace("INSTAGRAM_ACCESS_TOKEN=\n", ""),
    originalSource.replace(
      "INSTAGRAM_ACCESS_TOKEN=\n",
      "INSTAGRAM_ACCESS_TOKEN=\nINSTAGRAM_ACCESS_TOKEN=duplicate\n",
    ),
  ];
  for (const source of invalidAssignments) {
    await writeFile(envPath, source, { mode: 0o600 });
    const result = await runNode([installScript, "--confirm"], {
      cwd: root,
      env: process.env,
      input: token,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /exactly one/);
    assert.equal(await readFile(envPath, "utf8"), source);
    assert.equal((result.stdout + result.stderr).includes(token), false);
    assert.deepEqual(await temporaryFiles(root), []);
  }

  await writeFile(envPath, originalSource, { mode: 0o644 });
  const installed = await runNode([installScript, "--confirm"], {
    cwd: root,
    env: process.env,
    input: token,
  });
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal((installed.stdout + installed.stderr).includes(token), false);
  assert.equal(
    await readFile(envPath, "utf8"),
    originalSource.replace("INSTAGRAM_ACCESS_TOKEN=", `INSTAGRAM_ACCESS_TOKEN=${JSON.stringify(token)}`),
  );
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.deepEqual(await temporaryFiles(root), []);

  const metadataPath = resolve(root, "state/private/instagram-token.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(metadata.expiresInSeconds, 5184000);
  assert.notEqual(metadata.tokenSha256, token);
  assert.equal((await stat(metadataPath)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(metadataPath))).mode & 0o777, 0o700);
});

test("token refresh rotates .env.local safely and records expiration metadata", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "perigee-social-token-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(repoRoot, "skills"), resolve(root, "skills"), { recursive: true });

  const oldToken = `IG${"a".repeat(62)}`;
  const newToken = `IG${"b".repeat(62)}`;
  const accountId = "17841400000000000";
  const envPath = resolve(root, ".env.local");
  const originalSource = envSource(accountId);
  await writeFile(envPath, originalSource, { mode: 0o600 });

  let refreshRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/refresh_access_token") {
      refreshRequests += 1;
      assert.equal(url.searchParams.get("grant_type"), "ig_refresh_token");
      assert.equal(url.searchParams.get("access_token"), oldToken);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ access_token: newToken, token_type: "bearer", expires_in: 5184000 }));
      return;
    }
    if (url.pathname === "/v25.0/me") {
      assert.equal(request.headers.authorization, `Bearer ${newToken}`);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ user_id: accountId, username: "perigeetides", account_type: "Business" }));
      return;
    }
    if (url.pathname === `/v25.0/${accountId}/content_publishing_limit`) {
      assert.equal(request.headers.authorization, `Bearer ${newToken}`);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ quota_usage: 3, config: { quota_total: 50 } }] }));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { type: "MockNotFound", code: 404 } }));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const environment = {
    ...process.env,
    PERIGEE_SOCIAL_TEST_MODE: "1",
    PERIGEE_SOCIAL_TEST_REFRESH_URL: `${baseUrl}/refresh_access_token`,
    PERIGEE_SOCIAL_TEST_GRAPH_BASE_URL: `${baseUrl}/v25.0`,
  };

  const installScript = resolve(root, "skills/perigee-social-publisher/scripts/install-token.mjs");
  const installed = await runNode([installScript, "--confirm"], {
    cwd: root,
    env: environment,
    input: oldToken,
  });
  assert.equal(installed.code, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout + installed.stderr, new RegExp(`${oldToken}|${newToken}`));
  assert.equal(
    await readFile(envPath, "utf8"),
    originalSource.replace("INSTAGRAM_ACCESS_TOKEN=", `INSTAGRAM_ACCESS_TOKEN=${JSON.stringify(oldToken)}`),
  );
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.deepEqual(await temporaryFiles(root), []);

  const statusScript = resolve(root, "skills/perigee-social-publisher/scripts/token-status.mjs");
  const initialStatus = await runNode([statusScript], { cwd: root, env: environment });
  assert.equal(initialStatus.code, 0, initialStatus.stderr);
  assert.match(initialStatus.stdout, /"status": "healthy"/);

  const refreshScript = resolve(root, "skills/perigee-social-publisher/scripts/refresh-token.mjs");
  const unconfirmed = await runNode([refreshScript], { cwd: root, env: environment });
  assert.notEqual(unconfirmed.code, 0);
  assert.match(unconfirmed.stderr, /explicit --confirm gate/);
  assert.equal(refreshRequests, 0);

  const refreshed = await runNode([refreshScript, "--confirm"], { cwd: root, env: environment });
  assert.equal(refreshed.code, 0, refreshed.stderr);
  assert.equal(refreshRequests, 1);
  assert.doesNotMatch(refreshed.stdout + refreshed.stderr, new RegExp(`${oldToken}|${newToken}`));

  const updatedEnv = await readFile(envPath, "utf8");
  assert.doesNotMatch(updatedEnv, new RegExp(oldToken));
  assert.match(updatedEnv, new RegExp(`INSTAGRAM_ACCESS_TOKEN=${JSON.stringify(newToken)}`));
  assert.match(updatedEnv, /# Preserve comments and unrelated settings byte-for-byte\./);
  assert.match(updatedEnv, /UNRELATED_SETTING=preserve-me/);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.deepEqual(await temporaryFiles(root), []);

  const metadataPath = resolve(root, "state/private/instagram-token.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(metadata.expiresInSeconds, 5184000);
  assert.notEqual(metadata.tokenSha256, newToken);
  assert.equal((await stat(metadataPath)).mode & 0o777, 0o600);

  const status = await runNode([statusScript], { cwd: root, env: environment });
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /"status": "healthy"/);
  assert.doesNotMatch(status.stdout + status.stderr, new RegExp(`${oldToken}|${newToken}`));

  const verifyScript = resolve(root, "skills/perigee-social-publisher/scripts/verify-account.mjs");
  const verified = await runNode([verifyScript], { cwd: root, env: environment });
  assert.equal(verified.code, 0, verified.stderr);
  assert.match(verified.stdout, /"passed": true/);
  assert.match(verified.stdout, /"remaining": 47/);
  assert.doesNotMatch(verified.stdout + verified.stderr, new RegExp(`${oldToken}|${newToken}`));
});
