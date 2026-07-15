import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function runNode(args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, options);
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
  });
}

test("token refresh rotates .env.local safely and records expiration metadata", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "perigee-social-token-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(resolve(repoRoot, "skills"), resolve(root, "skills"), { recursive: true });

  const oldToken = "old-token-never-log";
  const newToken = "new-token-never-log";
  const accountId = "17841400000000000";
  const envPath = resolve(root, ".env.local");
  await writeFile(envPath, [
    "INSTAGRAM_API_VERSION=v25.0",
    `INSTAGRAM_ACCOUNT_ID=${accountId}`,
    "INSTAGRAM_ACCOUNT_HANDLE=perigeetides",
    `INSTAGRAM_ACCESS_TOKEN=${oldToken}`,
    "PUBLIC_MEDIA_BASE_URL=https://example.com/posts",
    "",
  ].join("\n"), { mode: 0o600 });

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

  const recordScript = resolve(root, "skills/perigee-social-publisher/scripts/record-token.mjs");
  const unconfirmedRecord = await runNode([recordScript], { cwd: root, env: environment });
  assert.notEqual(unconfirmedRecord.code, 0);
  assert.match(unconfirmedRecord.stderr, /explicit --confirm gate/);
  const recorded = await runNode([recordScript, "--confirm"], { cwd: root, env: environment });
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.doesNotMatch(recorded.stdout + recorded.stderr, new RegExp(`${oldToken}|${newToken}`));

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
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);

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
