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
const pageId = "123456789012345";
const accessToken = "mock-facebook-page-token-never-send";

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function runNode(args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

test("Facebook publisher uploads five accessible photos, reconciles ambiguity, and verifies the live post", { timeout: 30000 }, async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "perigee-facebook-publisher-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await Promise.all([
    cp(resolve(repoRoot, "skills"), resolve(temporaryRoot, "skills"), { recursive: true }),
    cp(resolve(repoRoot, "config"), resolve(temporaryRoot, "config"), { recursive: true }),
    cp(resolve(repoRoot, "content/posts", postId), resolve(temporaryRoot, "content/posts", postId), { recursive: true }),
  ]);
  await symlink(resolve(repoRoot, "node_modules"), resolve(temporaryRoot, "node_modules"), "dir");

  const requests = [];
  const expectedMedia = new Map();
  const photoIds = ["7101", "7102", "7103", "7104", "7105"];
  let photoUploadCount = 0;
  let feedPublishAttempts = 0;
  let liveReadCount = 0;
  let expectedCaption = "";
  let expectedSlides = [];
  const livePayload = () => ({
    id: `${pageId}_9001`,
    permalink_url: "https://www.facebook.com/perigeetides/posts/9001",
    message: expectedCaption,
    created_time: new Date().toISOString(),
    attachments: {
      data: [{
        media_type: "album",
        subattachments: { data: photoIds.map((id) => ({ media_type: "photo", target: { id } })) },
      }],
    },
  });

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
    if (request.method === "GET" && url.pathname === `/v25.0/${pageId}`) {
      assert.equal(url.searchParams.get("fields"), "id,name,username,link");
      sendJson(response, 200, {
        id: pageId,
        name: "Perigee Tides",
        username: "perigeetides",
        link: "https://www.facebook.com/perigeetides",
      });
      return;
    }
    if (request.method === "POST" && url.pathname === `/v25.0/${pageId}/photos`) {
      const fields = Object.fromEntries(new URLSearchParams(body));
      const slide = expectedSlides[photoUploadCount];
      assert.equal(fields.url, slide.publicUrl);
      assert.equal(fields.published, "false");
      assert.equal(fields.alt_text_custom, slide.altText);
      sendJson(response, 200, { id: photoIds[photoUploadCount] });
      photoUploadCount += 1;
      return;
    }
    if (request.method === "POST" && url.pathname === `/v25.0/${pageId}/feed`) {
      const fields = Object.fromEntries(new URLSearchParams(body));
      assert.equal(fields.message, expectedCaption);
      for (let index = 0; index < photoIds.length; index += 1) {
        assert.deepEqual(JSON.parse(fields[`attached_media[${index}]`]), { media_fbid: photoIds[index] });
      }
      feedPublishAttempts += 1;
      request.socket.destroy();
      return;
    }
    if (request.method === "GET" && url.pathname === `/v25.0/${pageId}/feed`) {
      assert.equal(url.searchParams.get("limit"), "25");
      sendJson(response, 200, { data: [livePayload()] });
      return;
    }
    if (request.method === "GET" && url.pathname === `/v25.0/${pageId}_9001`) {
      liveReadCount += 1;
      const payload = livePayload();
      if (liveReadCount === 1) payload.attachments.data[0].subattachments.data.pop();
      sendJson(response, 200, payload);
      return;
    }
    sendJson(response, 404, { error: { type: "MockNotFound", code: 404 } });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const manifestPath = resolve(temporaryRoot, manifestRelativePath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const now = new Date().toISOString();
  manifest.generatedAt = now;
  manifest.sources.fetchedAt = now;
  manifest.status = "published";
  manifest.approval.policy = "automatic-after-validation";
  expectedSlides = [...manifest.creative.slides].sort((left, right) => left.order - right.order);
  for (const slide of expectedSlides) {
    const publicPath = `/public/${slide.order}.jpg`;
    slide.publicUrl = `${baseUrl}${publicPath}`;
    expectedMedia.set(publicPath, await readFile(resolve(temporaryRoot, slide.file)));
  }
  expectedCaption = manifest.creative.captions?.facebook || manifest.creative.caption;
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const script = resolve(temporaryRoot, "skills/perigee-social-publisher/scripts/publish-facebook.mjs");
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    PERIGEE_SOCIAL_TEST_MODE: "1",
    PERIGEE_SOCIAL_TEST_FACEBOOK_GRAPH_BASE_URL: `${baseUrl}/v25.0`,
    FACEBOOK_GRAPH_API_VERSION: "v25.0",
    FACEBOOK_PAGE_ID: pageId,
    FACEBOOK_PAGE_NAME: "Perigee Tides",
    FACEBOOK_PAGE_HANDLE: "perigeetides",
    FACEBOOK_PAGE_ACCESS_TOKEN: accessToken,
    PUBLIC_MEDIA_BASE_URL: `${baseUrl}/public`,
  };

  const firstRun = await runNode([script, "--manifest", manifestRelativePath, "--confirm"], {
    cwd: temporaryRoot,
    env: environment,
  });
  assert.notEqual(firstRun.code, 0);
  assert.match(firstRun.stderr, /Publish outcome is ambiguous/);
  assert.doesNotMatch(firstRun.stdout + firstRun.stderr, new RegExp(accessToken));
  const journalPath = resolve(temporaryRoot, "state/publishing/facebook", `${postId}.json`);
  const ambiguousJournal = JSON.parse(await readFile(journalPath, "utf8"));
  assert.equal(ambiguousJournal.status, "publish-requesting");
  assert.deepEqual(ambiguousJournal.photos.map((photo) => photo.id), photoIds);

  const recoveryRun = await runNode([script, "--manifest", manifestRelativePath, "--confirm"], {
    cwd: temporaryRoot,
    env: environment,
  });
  assert.equal(recoveryRun.code, 0, recoveryRun.stderr);
  assert.doesNotMatch(recoveryRun.stdout + recoveryRun.stderr, new RegExp(accessToken));
  const publishedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(publishedManifest.publishing.facebook.status, "published");
  assert.equal(publishedManifest.publishing.facebook.mediaId, `${pageId}_9001`);
  assert.equal(publishedManifest.publishing.facebook.permalink, "https://www.facebook.com/perigeetides/posts/9001");

  const ledgerLines = (await readFile(resolve(temporaryRoot, "state/publishing-ledger.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(ledgerLines.map((entry) => entry.platform), ["facebook"]);
  assert.equal(photoUploadCount, 5);
  assert.equal(feedPublishAttempts, 1);
  assert.equal(liveReadCount, 2);
  assert.ok(requests.every((request) => !request.pathname.includes(accessToken) && !request.body.includes(accessToken)));

  const requestCountBeforeDuplicate = requests.length;
  const duplicateRun = await runNode([script, "--manifest", manifestRelativePath, "--confirm"], {
    cwd: temporaryRoot,
    env: environment,
  });
  assert.equal(duplicateRun.code, 0, duplicateRun.stderr);
  assert.match(duplicateRun.stdout, /already-published/);
  assert.equal(requests.length, requestCountBeforeDuplicate);
});
