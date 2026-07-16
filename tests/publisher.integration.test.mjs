import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const postId = "2026-07-15-golden-gate-king-tide";
const manifestRelativePath = `content/posts/${postId}/manifest.json`;
const accountId = "17841400000000000";
const accessToken = "mock-access-token-never-send";

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

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

test("publisher executes and verifies the complete Instagram carousel flow", { timeout: 30000 }, async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "perigee-social-publisher-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  await Promise.all([
    cp(resolve(repoRoot, "skills"), resolve(temporaryRoot, "skills"), { recursive: true }),
    cp(resolve(repoRoot, "config"), resolve(temporaryRoot, "config"), { recursive: true }),
    cp(
      resolve(repoRoot, "content/posts", postId),
      resolve(temporaryRoot, "content/posts", postId),
      { recursive: true },
    ),
  ]);
  await symlink(resolve(repoRoot, "node_modules"), resolve(temporaryRoot, "node_modules"), "dir");

  const requests = [];
  let childContainerCount = 0;
  let publishAttempts = 0;
  let liveReadCount = 0;
  let profileUsername = "perigeetides";
  let expectedCaption = "";
  let expectedSlides = [];
  const expectedMedia = new Map();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: request.headers.authorization || null,
      body,
    });

    if (request.method === "GET" && url.pathname.startsWith("/public/")) {
      const bytes = expectedMedia.get(url.pathname);
      if (!bytes) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": bytes.length });
      response.end(bytes);
      return;
    }

    if (request.headers.authorization !== `Bearer ${accessToken}`) {
      sendJson(response, 401, { error: { type: "OAuthException", code: 190 } });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v25.0/me") {
      assert.equal(url.searchParams.get("fields"), "user_id,username,account_type");
      sendJson(response, 200, { user_id: accountId, username: profileUsername, account_type: "Business" });
      return;
    }

    if (request.method === "GET" && url.pathname === `/v25.0/${accountId}/content_publishing_limit`) {
      assert.equal(url.searchParams.get("fields"), "quota_usage,config");
      sendJson(response, 200, { data: [{ quota_usage: 4, config: { quota_total: 50 } }] });
      return;
    }

    if (request.method === "POST" && url.pathname === `/v25.0/${accountId}/media`) {
      const fields = Object.fromEntries(new URLSearchParams(body));
      if (fields.media_type === "CAROUSEL") {
        assert.equal(fields.children, "2001,2002,2003,2004,2005");
        assert.equal(fields.caption, expectedCaption);
        assert.equal(fields.location_id, "123456789");
        sendJson(response, 200, { id: "3001" });
        return;
      }
      childContainerCount += 1;
      assert.equal(fields.image_url, expectedSlides[childContainerCount - 1].publicUrl);
      assert.equal(fields.is_carousel_item, "true");
      assert.equal(fields.alt_text, expectedSlides[childContainerCount - 1].altText);
      sendJson(response, 200, { id: String(2000 + childContainerCount) });
      return;
    }

    if (request.method === "GET" && /^\/v25\.0\/(200[1-5]|3001)$/.test(url.pathname)) {
      assert.equal(url.searchParams.get("fields"), "status_code");
      sendJson(response, 200, { status_code: "FINISHED" });
      return;
    }

    if (request.method === "POST" && url.pathname === `/v25.0/${accountId}/media_publish`) {
      assert.equal(new URLSearchParams(body).get("creation_id"), "3001");
      publishAttempts += 1;
      if (publishAttempts === 1) {
        request.socket.destroy();
        return;
      }
      sendJson(response, 500, { error: { type: "DuplicatePublish", code: 500 } });
      return;
    }

    const livePayload = () => ({
      id: "9001",
      permalink: "https://www.instagram.com/p/perigee-mock/",
      caption: expectedCaption,
      media_type: "CAROUSEL_ALBUM",
      timestamp: new Date().toISOString(),
      children: {
        data: expectedSlides.map((slide) => ({ media_type: "IMAGE", alt_text: slide.altText })),
      },
    });

    if (request.method === "GET" && url.pathname === `/v25.0/${accountId}/media`) {
      assert.equal(url.searchParams.get("fields"), "id,permalink,caption,media_type,timestamp,children{alt_text,media_type}");
      assert.equal(url.searchParams.get("limit"), "25");
      sendJson(response, 200, { data: [livePayload()] });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v25.0/9001") {
      assert.equal(
        url.searchParams.get("fields"),
        "id,permalink,caption,media_type,timestamp,children{alt_text,media_type}",
      );
      liveReadCount += 1;
      const payload = livePayload();
      if (liveReadCount === 1) payload.children.data.pop();
      sendJson(response, 200, payload);
      return;
    }

    sendJson(response, 404, { error: { type: "MockNotFound", code: 404 } });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const manifestPath = resolve(temporaryRoot, manifestRelativePath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const now = new Date().toISOString();
  manifest.generatedAt = now;
  manifest.sources.fetchedAt = now;
  manifest.status = "staged";
  manifest.publishing.status = "staged-not-published";
  manifest.publishing.mediaId = null;
  manifest.publishing.permalink = null;
  manifest.creative.discovery = { locationTag: { instagramLocationId: "123456789" } };
  expectedSlides = [...manifest.creative.slides].sort((left, right) => left.order - right.order);
  for (const slide of expectedSlides) {
    const publicPath = `/public/${slide.order}.jpg`;
    slide.publicUrl = `${baseUrl}${publicPath}`;
    expectedMedia.set(publicPath, await readFile(resolve(temporaryRoot, slide.file)));
  }
  expectedCaption = manifest.creative.caption;
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const script = resolve(temporaryRoot, "skills/perigee-social-publisher/scripts/publish.mjs");
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    PERIGEE_SOCIAL_TEST_MODE: "1",
    PERIGEE_SOCIAL_TEST_GRAPH_BASE_URL: `${baseUrl}/v25.0`,
    INSTAGRAM_API_VERSION: "v25.0",
    INSTAGRAM_ACCOUNT_ID: accountId,
    INSTAGRAM_ACCOUNT_HANDLE: "perigeetides",
    INSTAGRAM_ACCESS_TOKEN: accessToken,
    PUBLIC_MEDIA_BASE_URL: `${baseUrl}/public`,
  };

  manifest.approval.policy = "manual";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const badPolicyRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.notEqual(badPolicyRun.code, 0);
  assert.match(badPolicyRun.stderr, /validation failed/);
  assert.equal(requests.length, 0);
  manifest.approval.policy = "automatic-after-validation";

  const originalSecondOrder = manifest.creative.slides[1].order;
  manifest.creative.slides[1].order = 1;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const badOrderRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.notEqual(badOrderRun.code, 0);
  assert.match(badOrderRun.stderr, /validation failed/);
  assert.equal(requests.length, 0);
  manifest.creative.slides[1].order = originalSecondOrder;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const firstMediaPath = "/public/1.jpg";
  const correctFirstMedia = expectedMedia.get(firstMediaPath);
  expectedMedia.set(firstMediaPath, Buffer.from("wrong jpeg bytes"));
  const badMediaRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.notEqual(badMediaRun.code, 0);
  assert.match(badMediaRun.stderr, /checksum failed for slide 1/);
  assert.equal(requests.filter((request) => request.pathname.startsWith("/v25.0/")).length, 0);
  expectedMedia.set(firstMediaPath, correctFirstMedia);
  requests.length = 0;

  profileUsername = "wrong_account";
  const wrongAccountRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.notEqual(wrongAccountRun.code, 0);
  assert.match(wrongAccountRun.stderr, /username does not match/);
  assert.equal(requests.filter((request) => request.method === "POST").length, 0);
  profileUsername = "perigeetides";
  requests.length = 0;

  const firstRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.notEqual(firstRun.code, 0);
  assert.match(firstRun.stderr, /Publish outcome is ambiguous/);
  assert.doesNotMatch(firstRun.stdout + firstRun.stderr, new RegExp(accessToken));

  const journalPath = resolve(temporaryRoot, "state/publishing", `${postId}.json`);
  const ambiguousJournal = JSON.parse(await readFile(journalPath, "utf8"));
  assert.equal(ambiguousJournal.status, "publish-requesting");
  assert.equal(ambiguousJournal.carouselId, "3001");

  const recoveryRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.equal(recoveryRun.code, 0, recoveryRun.stderr);
  assert.doesNotMatch(recoveryRun.stdout + recoveryRun.stderr, new RegExp(accessToken));

  const publishedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(publishedManifest.status, "published");
  assert.equal(publishedManifest.publishing.mediaId, "9001");
  assert.equal(publishedManifest.publishing.permalink, "https://www.instagram.com/p/perigee-mock/");

  const ledgerLines = (await readFile(resolve(temporaryRoot, "state/publishing-ledger.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(ledgerLines.map((entry) => entry.event), ["live-verified"]);
  assert.ok(ledgerLines.every((entry) => entry.postId === postId));
  assert.ok(ledgerLines.every((entry) => entry.accountIdHash !== accountId));

  assert.equal(childContainerCount, 5);
  assert.equal(publishAttempts, 1);
  assert.equal(liveReadCount, 2);
  assert.equal(requests.filter((request) => request.pathname.startsWith("/public/")).length, 10);
  assert.ok(
    requests
      .filter((request) => request.pathname.startsWith("/v25.0/"))
      .every((request) => request.authorization === `Bearer ${accessToken}`),
  );
  assert.ok(requests.every((request) => !request.pathname.includes(accessToken) && !request.body.includes(accessToken)));

  publishedManifest.status = "staged";
  publishedManifest.publishing.status = "staged-not-published";
  await writeFile(manifestPath, `${JSON.stringify(publishedManifest, null, 2)}\n`, "utf8");
  const requestCountBeforeDuplicate = requests.length;
  const duplicateRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.equal(duplicateRun.code, 0, duplicateRun.stderr);
  assert.match(duplicateRun.stdout, /already-published/);
  assert.equal(requests.length, requestCountBeforeDuplicate);

  const lockPath = resolve(temporaryRoot, "state/locks", `${postId}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, "held by test\n", "utf8");
  const lockedRun = await runNode(
    [script, "--manifest", manifestRelativePath, "--confirm"],
    { cwd: temporaryRoot, env: environment },
  );
  assert.notEqual(lockedRun.code, 0);
  assert.match(lockedRun.stderr, /already holds the lock/);
  assert.equal(requests.length, requestCountBeforeDuplicate);
  await rm(lockPath, { force: true });
});
