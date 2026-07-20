#!/usr/bin/env node

import { appendFile, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { LEDGER_PATH, PROJECT_ROOT, loadConfig, pathExists } from "./lib/paths.mjs";
import { atomicWriteJson, loadEnvLocal, parseArgs, sha256 } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const LIVE_FIELDS = "id,permalink_url,message,created_time,attachments{media_type,subattachments.limit(10){media_type,target,url}}";
const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
if (!args.confirm) throw new Error("Facebook publication requires the explicit --confirm gate.");
await loadEnvLocal(resolve(PROJECT_ROOT, ".env.local"));

const required = [
  "FACEBOOK_GRAPH_API_VERSION",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_NAME",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
  "PUBLIC_MEDIA_BASE_URL",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing required Facebook publication configuration: ${missing.join(", ")}.`);

const testMode = process.env.PERIGEE_SOCIAL_TEST_MODE === "1";
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

function parseAllowedUrl(value, label, { allowLoopbackHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  const loopbackTestUrl = testMode && allowLoopbackHttp && loopbackHosts.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(loopbackTestUrl && parsed.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS.`);
  }
  return parsed;
}

async function readJsonLines(path) {
  if (!(await pathExists(path))) return [];
  return (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function acquirePublicationLock(postId) {
  const lockDirectory = resolve(PROJECT_ROOT, "state/locks");
  const lockPath = resolve(lockDirectory, `${postId}.facebook.lock`);
  await mkdir(lockDirectory, { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ postId, platform: "facebook", acquiredAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") throw new Error(`Another Facebook publication attempt already holds the lock for ${postId}.`);
    throw error;
  }
  await handle.close();
  return async () => rm(lockPath, { force: true });
}

const version = process.env.FACEBOOK_GRAPH_API_VERSION;
const pageId = process.env.FACEBOOK_PAGE_ID;
const expectedPageName = process.env.FACEBOOK_PAGE_NAME.trim();
const expectedHandle = String(process.env.FACEBOOK_PAGE_HANDLE || "").trim().replace(/^@/, "").toLowerCase();
const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
if (!/^v\d+\.\d+$/.test(version)) throw new Error("FACEBOOK_GRAPH_API_VERSION must look like v25.0.");
if (!/^\d+$/.test(pageId)) throw new Error("FACEBOOK_PAGE_ID must contain only digits.");
if (expectedHandle && !/^[a-z0-9.]{5,50}$/.test(expectedHandle)) throw new Error("FACEBOOK_PAGE_HANDLE is invalid.");

const publicBaseUrl = parseAllowedUrl(process.env.PUBLIC_MEDIA_BASE_URL, "PUBLIC_MEDIA_BASE_URL", { allowLoopbackHttp: true });
const publicBasePrefix = `${publicBaseUrl.toString().replace(/\/$/, "")}/`;

let graphHost = `https://graph.facebook.com/${version}`;
if (testMode) {
  const override = process.env.PERIGEE_SOCIAL_TEST_FACEBOOK_GRAPH_BASE_URL;
  if (!override) throw new Error("Test mode requires PERIGEE_SOCIAL_TEST_FACEBOOK_GRAPH_BASE_URL.");
  const parsedOverride = parseAllowedUrl(override, "PERIGEE_SOCIAL_TEST_FACEBOOK_GRAPH_BASE_URL", { allowLoopbackHttp: true });
  if (!loopbackHosts.has(parsedOverride.hostname)) throw new Error("The Facebook test Graph API override must use a loopback host.");
  graphHost = parsedOverride.toString().replace(/\/$/, "");
}

async function graph(path, { method = "GET", fields = null } = {}) {
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  };
  if (fields) {
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(fields);
  }
  const response = await fetch(`${graphHost}${path}`, options);
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok || body.error) {
    const code = body.error?.code || response.status;
    const type = body.error?.type || "facebook_api_error";
    const error = new Error(`Facebook API request failed (${type}, code ${code}).`);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return body;
}

async function verifyPublicMedia(orderedSlides) {
  for (const slide of orderedSlides) {
    if (!slide.publicUrl) throw new Error(`Slide ${slide.order} has not been staged to a public URL.`);
    const parsed = parseAllowedUrl(slide.publicUrl, `Public URL for slide ${slide.order}`, { allowLoopbackHttp: true });
    if (!parsed.toString().startsWith(publicBasePrefix)) throw new Error(`Public URL for slide ${slide.order} is outside PUBLIC_MEDIA_BASE_URL.`);
    const response = await fetch(parsed, { method: "GET", redirect: "error", signal: AbortSignal.timeout(20000) });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("image/jpeg")) {
      throw new Error(`Public-media verification failed for slide ${slide.order} with HTTP ${response.status}.`);
    }
    if (!response.url.startsWith(publicBasePrefix)) throw new Error(`Public-media response for slide ${slide.order} escaped PUBLIC_MEDIA_BASE_URL.`);
    const digest = sha256(new Uint8Array(await response.arrayBuffer()));
    if (digest !== slide.sha256) throw new Error(`Public-media checksum failed for slide ${slide.order}.`);
  }
}

async function verifyPageIdentity() {
  const fields = "id,name,username,link";
  const profile = await graph(`/${pageId}?fields=${encodeURIComponent(fields)}`);
  if (String(profile.id || "") !== pageId) throw new Error("Authenticated Facebook Page ID does not match FACEBOOK_PAGE_ID.");
  if (String(profile.name || "").trim() !== expectedPageName) throw new Error("Authenticated Facebook Page name does not match FACEBOOK_PAGE_NAME.");
  if (expectedHandle && String(profile.username || "").toLowerCase() !== expectedHandle) {
    throw new Error("Authenticated Facebook Page username does not match FACEBOOK_PAGE_HANDLE.");
  }
  if (!profile.link) throw new Error("Facebook did not return a public Page link.");
  return profile;
}

function attachmentPhotoIds(live) {
  const attachments = live?.attachments?.data?.[0]?.subattachments?.data;
  if (!Array.isArray(attachments)) return [];
  return attachments.map((attachment) => String(attachment.target?.id || ""));
}

function liveVerificationError(live, manifest, orderedPhotoIds) {
  if (!live?.id || !live?.permalink_url) return "Facebook publication returned no verifiable permalink.";
  const expectedCaption = manifest.creative.captions?.facebook || manifest.creative.caption;
  if ((live.message || "").trim() !== expectedCaption.trim()) return "Facebook live caption does not match the staged manifest.";
  const livePhotoIds = attachmentPhotoIds(live);
  if (livePhotoIds.length !== orderedPhotoIds.length) return "Facebook live post does not contain the expected number of photos.";
  if (JSON.stringify(livePhotoIds) !== JSON.stringify(orderedPhotoIds)) return "Facebook live photo order does not match the staged carousel order.";
  return null;
}

async function readAndVerifyLive(postId, manifest, orderedPhotoIds) {
  const maximumAttempts = testMode ? 3 : 7;
  const pollingIntervalMs = testMode ? 1 : 10000;
  let lastError = "Facebook live post was not ready for verification.";
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const live = await graph(`/${postId}?fields=${encodeURIComponent(LIVE_FIELDS)}`);
      if (String(live.id || "") !== String(postId)) {
        lastError = "Facebook live post ID does not match the publish response.";
      } else {
        const verificationError = liveVerificationError(live, manifest, orderedPhotoIds);
        if (!verificationError) return live;
        lastError = verificationError;
      }
    } catch (error) {
      lastError = error.message;
    }
    if (attempt + 1 < maximumAttempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, pollingIntervalMs));
  }
  throw new Error(`${lastError} Verification did not converge within one minute.`);
}

async function reconcileAmbiguousPublish(journal, manifest) {
  const response = await graph(`/${pageId}/feed?fields=${encodeURIComponent(LIVE_FIELDS)}&limit=25`);
  const requestedAt = Date.parse(journal.requestedAt || "");
  const orderedPhotoIds = journal.photos.map((photo) => photo.id);
  const matches = (response.data || []).filter((post) => {
    const createdAt = Date.parse(post.created_time || "");
    const recentEnough = !Number.isFinite(requestedAt) || !Number.isFinite(createdAt) ? true : createdAt >= requestedAt - 300000;
    return recentEnough && !liveVerificationError(post, manifest, orderedPhotoIds);
  });
  if (matches.length > 1) throw new Error("More than one live Facebook post matches the ambiguous publication attempt.");
  return matches[0] || null;
}

async function runPublisher() {
  const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
  if (!manifestPath.startsWith(`${PROJECT_ROOT}${sep}`)) throw new Error("Manifest must be inside the Perigee Social Media repository.");
  const config = await loadConfig();
  const manifest = await readManifest(manifestPath);
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/.test(manifest.id || "")) throw new Error("Manifest post ID is invalid.");

  const releaseLock = await acquirePublicationLock(manifest.id);
  try {
    const orderedSlides = [...(manifest.creative?.slides || [])].sort((left, right) => left.order - right.order);
    const journalPath = resolve(PROJECT_ROOT, "state/publishing/facebook", `${manifest.id}.json`);
    const journalExists = await pathExists(journalPath);
    let journal = journalExists ? JSON.parse(await readFile(journalPath, "utf8")) : null;
    const recovering = ["publish-requesting", "publish-received"].includes(journal?.status);
    const report = await validateManifest(manifest, manifestPath, config, { allowStaleSource: recovering });
    if (!report.passed) throw new Error(`Refusing to publish ${manifest.id} to Facebook; validation failed.`);

    const manualTypes = config.publishing?.manualReviewTypes || [];
    const autoTypes = config.publishing?.autoPublishTypes || [];
    const contentType = manifest.creative.contentType;
    const expectedPolicy = manualTypes.includes(contentType) ? "manual" : autoTypes.includes(contentType) ? "automatic-after-validation" : null;
    if (!expectedPolicy || manifest.approval?.policy !== expectedPolicy) throw new Error(`Manifest review policy is invalid for ${contentType}.`);
    if (expectedPolicy === "manual" && !args["manual-approved"]) throw new Error("This content type requires --manual-approved in addition to --confirm.");

    const ledgerEntries = await readJsonLines(LEDGER_PATH);
    const completedEntry = ledgerEntries.find(
      (entry) => entry.platform === "facebook" && entry.postId === manifest.id && entry.mediaId && entry.permalink,
    );
    if (completedEntry) {
      manifest.status = "published";
      manifest.publishing = {
        ...manifest.publishing,
        facebook: {
          status: "published",
          mediaId: completedEntry.mediaId,
          permalink: completedEntry.permalink,
          publishedAt: completedEntry.publishedAt,
        },
      };
      await atomicWriteJson(manifestPath, manifest);
      console.log(JSON.stringify({
        postId: manifest.id,
        platform: "facebook",
        status: "already-published",
        mediaId: completedEntry.mediaId,
        permalink: completedEntry.permalink,
      }, null, 2));
      return;
    }

    if (!["staged", "published"].includes(manifest.status)) {
      throw new Error(`Refusing to publish ${manifest.id} to Facebook; run the staging gate first.`);
    }

    const manifestDigest = sha256(JSON.stringify(manifest));
    const pageIdHash = sha256(pageId);
    if (journal) {
      if (journal.postId !== manifest.id || journal.manifestSha256 !== manifestDigest) throw new Error(`Facebook publication journal for ${manifest.id} does not match the staged manifest.`);
      if (journal.pageIdHash !== pageIdHash) throw new Error(`Facebook publication journal for ${manifest.id} belongs to a different Page.`);
    } else {
      journal = {
        schemaVersion: 1,
        platform: "facebook",
        postId: manifest.id,
        status: "prepared",
        pageIdHash,
        manifestSha256: manifestDigest,
        photos: [],
        mediaId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await atomicWriteJson(journalPath, journal);
    }

    const saveJournal = async () => {
      journal.updatedAt = new Date().toISOString();
      await atomicWriteJson(journalPath, journal);
    };

    await verifyPublicMedia(orderedSlides);
    const page = await verifyPageIdentity();

    if (journal.status === "publish-requesting") {
      const reconciled = await reconcileAmbiguousPublish(journal, manifest);
      if (!reconciled) {
        throw new Error(`Facebook publish outcome remains ambiguous. Journal preserved at ${relative(PROJECT_ROOT, journalPath)}; publication will not be retried.`);
      }
      journal.status = "publish-received";
      journal.mediaId = reconciled.id;
      journal.receivedAt = new Date().toISOString();
      await saveJournal();
    }

    if (!journal.mediaId) {
      for (const slide of orderedSlides) {
        let photo = journal.photos.find((entry) => entry.order === slide.order);
        if (!photo) {
          const created = await graph(`/${pageId}/photos`, {
            method: "POST",
            fields: {
              url: slide.publicUrl,
              published: "false",
              alt_text_custom: slide.altText,
            },
          });
          if (!created.id) throw new Error(`Facebook did not return a photo ID for slide ${slide.order}.`);
          photo = { order: slide.order, id: String(created.id) };
          journal.photos.push(photo);
          journal.photos.sort((left, right) => left.order - right.order);
          journal.status = "uploading-photos";
          await saveJournal();
        }
      }

      const feedFields = {
        message: manifest.creative.captions?.facebook || manifest.creative.caption,
        ...Object.fromEntries(journal.photos.map((photo, index) => [
          `attached_media[${index}]`,
          JSON.stringify({ media_fbid: photo.id }),
        ])),
      };
      journal.status = "publish-requesting";
      journal.requestedAt = new Date().toISOString();
      await saveJournal();
      let published;
      try {
        published = await graph(`/${pageId}/feed`, { method: "POST", fields: feedFields });
      } catch (error) {
        throw new Error(`${error.message} Publish outcome is ambiguous; rerun to reconcile ${relative(PROJECT_ROOT, journalPath)} without republishing.`);
      }
      if (!published.id) throw new Error("Facebook did not return a published post ID; outcome is ambiguous and will not be retried.");
      journal.status = "publish-received";
      journal.mediaId = String(published.id);
      journal.receivedAt = new Date().toISOString();
      await saveJournal();
    }

    const orderedPhotoIds = journal.photos.map((photo) => photo.id);
    const live = await readAndVerifyLive(journal.mediaId, manifest, orderedPhotoIds);
    const publishedAt = live.created_time || new Date().toISOString();
    const ledgerEntry = {
      schemaVersion: 1,
      event: "live-verified",
      postId: manifest.id,
      platform: "facebook",
      accountIdHash: pageIdHash,
      mediaId: live.id,
      permalink: live.permalink_url,
      publishedAt,
      manifestSha256: manifestDigest,
    };
    await mkdir(dirname(LEDGER_PATH), { recursive: true });
    await appendFile(LEDGER_PATH, `${JSON.stringify(ledgerEntry)}\n`, { encoding: "utf8", mode: 0o600 });

    manifest.status = "published";
    manifest.publishing = {
      ...manifest.publishing,
      facebook: {
        status: "published",
        mediaId: live.id,
        permalink: live.permalink_url,
        publishedAt,
      },
    };
    await atomicWriteJson(manifestPath, manifest);
    journal.status = "live-verified";
    journal.mediaId = live.id;
    journal.permalink = live.permalink_url;
    journal.publishedAt = publishedAt;
    journal.pageName = page.name;
    await saveJournal();

    console.log(JSON.stringify({
      postId: manifest.id,
      platform: "facebook",
      status: "published",
      mediaId: live.id,
      permalink: live.permalink_url,
    }, null, 2));
  } finally {
    await releaseLock();
  }
}

await runPublisher();
