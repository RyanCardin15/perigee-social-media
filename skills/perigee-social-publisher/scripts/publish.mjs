#!/usr/bin/env node

import { appendFile, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { LEDGER_PATH, PROJECT_ROOT, loadConfig, pathExists } from "./lib/paths.mjs";
import { atomicWriteJson, loadEnvLocal, parseArgs, sha256 } from "./lib/utils.mjs";
import { readManifest, validateManifest } from "./lib/validation.mjs";

const LIVE_FIELDS = "id,permalink,caption,media_type,timestamp,children{alt_text,media_type}";
const args = parseArgs(process.argv.slice(2));
if (!args.manifest) throw new Error("Pass --manifest <path>.");
if (!args.confirm) throw new Error("Publication requires the explicit --confirm gate.");
await loadEnvLocal(resolve(PROJECT_ROOT, ".env.local"));

const required = [
  "INSTAGRAM_API_VERSION",
  "INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_ACCOUNT_HANDLE",
  "INSTAGRAM_ACCESS_TOKEN",
  "PUBLIC_MEDIA_BASE_URL",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing required publication configuration: ${missing.join(", ")}.`);

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

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function sleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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
  const lockPath = resolve(lockDirectory, `${postId}.lock`);
  await mkdir(lockDirectory, { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ postId, acquiredAt: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error(`Another publication attempt already holds the lock for ${postId}.`);
    }
    throw error;
  }
  await handle.close();
  return async () => rm(lockPath, { force: true });
}

const version = process.env.INSTAGRAM_API_VERSION;
const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
const expectedHandle = normalizeHandle(process.env.INSTAGRAM_ACCOUNT_HANDLE);
if (!/^v\d+\.\d+$/.test(version)) throw new Error("INSTAGRAM_API_VERSION must look like v25.0.");
if (!/^\d+$/.test(accountId)) throw new Error("INSTAGRAM_ACCOUNT_ID must contain only digits.");
if (!/^[a-z0-9._]{1,30}$/.test(expectedHandle)) throw new Error("INSTAGRAM_ACCOUNT_HANDLE is invalid.");

const publicBaseUrl = parseAllowedUrl(process.env.PUBLIC_MEDIA_BASE_URL, "PUBLIC_MEDIA_BASE_URL", {
  allowLoopbackHttp: true,
});
const publicBasePrefix = `${publicBaseUrl.toString().replace(/\/$/, "")}/`;

let graphHost = `https://graph.instagram.com/${version}`;
if (testMode) {
  const override = process.env.PERIGEE_SOCIAL_TEST_GRAPH_BASE_URL;
  if (!override) throw new Error("Test mode requires PERIGEE_SOCIAL_TEST_GRAPH_BASE_URL.");
  const parsedOverride = parseAllowedUrl(override, "PERIGEE_SOCIAL_TEST_GRAPH_BASE_URL", {
    allowLoopbackHttp: true,
  });
  if (!loopbackHosts.has(parsedOverride.hostname)) {
    throw new Error("The test Graph API override must use a loopback host.");
  }
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
    const type = body.error?.type || "instagram_api_error";
    const error = new Error(`Instagram API request failed (${type}, code ${code}).`);
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return body;
}

async function verifyPublicMedia(orderedSlides) {
  for (const slide of orderedSlides) {
    if (!slide.publicUrl) throw new Error(`Slide ${slide.order} has not been staged to a public URL.`);
    const parsed = parseAllowedUrl(slide.publicUrl, `Public URL for slide ${slide.order}`, {
      allowLoopbackHttp: true,
    });
    if (!parsed.toString().startsWith(publicBasePrefix)) {
      throw new Error(`Public URL for slide ${slide.order} is outside PUBLIC_MEDIA_BASE_URL.`);
    }
    const response = await fetch(parsed, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("image/jpeg")) {
      throw new Error(`Public-media verification failed for slide ${slide.order} with HTTP ${response.status}.`);
    }
    if (!response.url.startsWith(publicBasePrefix)) {
      throw new Error(`Public-media response for slide ${slide.order} escaped PUBLIC_MEDIA_BASE_URL.`);
    }
    const digest = sha256(new Uint8Array(await response.arrayBuffer()));
    if (digest !== slide.sha256) {
      throw new Error(`Public-media checksum failed for slide ${slide.order}.`);
    }
  }
}

async function verifyAccountIdentity(manifest) {
  const manifestHandle = normalizeHandle(manifest.publishing?.accountHandle);
  if (manifestHandle !== expectedHandle) {
    throw new Error(`Manifest account handle ${manifestHandle || "missing"} does not match configured account.`);
  }
  const profile = await graph("/me?fields=user_id,username,account_type");
  if (String(profile.user_id || "") !== accountId) {
    throw new Error("Authenticated Instagram user ID does not match INSTAGRAM_ACCOUNT_ID.");
  }
  if (normalizeHandle(profile.username) !== expectedHandle) {
    throw new Error("Authenticated Instagram username does not match INSTAGRAM_ACCOUNT_HANDLE.");
  }
  if (String(profile.account_type || "").toLowerCase() !== "business") {
    throw new Error("Authenticated Instagram account must be a Business professional account.");
  }
}

async function verifyPublishingQuota() {
  const response = await graph(`/${accountId}/content_publishing_limit?fields=quota_usage,config`);
  const quota = response.data?.[0] || response;
  const usage = Number(quota.quota_usage);
  const total = Number(quota.config?.quota_total);
  if (!Number.isFinite(usage) || !Number.isFinite(total) || total <= 0) {
    throw new Error("Instagram did not return a valid content-publishing quota.");
  }
  if (usage >= total) {
    throw new Error(`Instagram content-publishing quota is exhausted (${usage}/${total}).`);
  }
  return { usage, total };
}

async function waitForContainer(containerId) {
  const maximumAttempts = testMode ? 2 : 6;
  const pollingIntervalMs = testMode ? 1 : 15000;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const status = await graph(`/${containerId}?fields=status_code`);
    if (status.status_code === "FINISHED" || status.status_code === "PUBLISHED") return;
    if (["ERROR", "EXPIRED"].includes(status.status_code)) {
      throw new Error(`Instagram rejected media container ${containerId} with status ${status.status_code}.`);
    }
    if (attempt + 1 < maximumAttempts) await sleep(pollingIntervalMs);
  }
  throw new Error(`Instagram media container ${containerId} did not finish within five minutes.`);
}

function liveVerificationError(live, manifest, orderedSlides) {
  if (!live?.permalink || !live?.id) return "Instagram publication returned no verifiable live permalink.";
  if (live.media_type !== "CAROUSEL_ALBUM") {
    return `Instagram returned media type ${live.media_type || "unknown"} instead of CAROUSEL_ALBUM.`;
  }
  if ((live.caption || "").trim() !== manifest.creative.caption.trim()) {
    return "Instagram live caption does not match the staged manifest.";
  }
  const liveChildren = live.children?.data;
  if (!Array.isArray(liveChildren) || liveChildren.length !== orderedSlides.length) {
    return "Instagram live carousel does not contain the expected number of slides.";
  }
  for (let index = 0; index < orderedSlides.length; index += 1) {
    if (liveChildren[index]?.media_type !== "IMAGE") {
      return `Instagram live slide ${index + 1} is not an image.`;
    }
    if ((liveChildren[index]?.alt_text || "").trim() !== orderedSlides[index].altText.trim()) {
      return `Instagram live slide ${index + 1} does not match the staged alt text order.`;
    }
  }
  return null;
}

async function readAndVerifyLive(mediaId, manifest, orderedSlides) {
  const maximumAttempts = testMode ? 3 : 7;
  const pollingIntervalMs = testMode ? 1 : 10000;
  let lastError = "Instagram live post was not ready for verification.";
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const live = await graph(`/${mediaId}?fields=${encodeURIComponent(LIVE_FIELDS)}`);
      if (live.id !== mediaId) {
        lastError = "Instagram live media ID does not match the publish response.";
      } else {
        const verificationError = liveVerificationError(live, manifest, orderedSlides);
        if (!verificationError) return live;
        lastError = verificationError;
      }
    } catch (error) {
      lastError = error.message;
    }
    if (attempt + 1 < maximumAttempts) await sleep(pollingIntervalMs);
  }
  throw new Error(`${lastError} Verification did not converge within one minute.`);
}

async function reconcileAmbiguousPublish(journal, manifest, orderedSlides) {
  const response = await graph(
    `/${accountId}/media?fields=${encodeURIComponent(LIVE_FIELDS)}&limit=25`,
  );
  const requestedAt = Date.parse(journal.requestedAt || "");
  const matches = (response.data || []).filter((media) => {
    const timestamp = Date.parse(media.timestamp || "");
    const recentEnough = !Number.isFinite(requestedAt) || !Number.isFinite(timestamp)
      ? true
      : timestamp >= requestedAt - 300000;
    return recentEnough
      && media.media_type === "CAROUSEL_ALBUM"
      && (media.caption || "").trim() === manifest.creative.caption.trim()
      && !liveVerificationError(media, manifest, orderedSlides);
  });
  if (matches.length > 1) {
    throw new Error("More than one live Instagram post matches the ambiguous publication attempt.");
  }
  return matches[0] || null;
}

async function runPublisher() {
  const manifestPath = resolve(PROJECT_ROOT, String(args.manifest));
  if (!manifestPath.startsWith(`${PROJECT_ROOT}${sep}`)) {
    throw new Error("Manifest must be inside the Perigee Social Media repository.");
  }
  const config = await loadConfig();
  const manifest = await readManifest(manifestPath);
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/.test(manifest.id || "")) {
    throw new Error("Manifest post ID is invalid.");
  }

  const releaseLock = await acquirePublicationLock(manifest.id);
  try {
    const orderedSlides = [...(manifest.creative?.slides || [])].sort((left, right) => left.order - right.order);
    const journalPath = resolve(PROJECT_ROOT, "state/publishing", `${manifest.id}.json`);
    const journalExists = await pathExists(journalPath);
    let journal = journalExists ? JSON.parse(await readFile(journalPath, "utf8")) : null;
    const recovering = ["publish-requesting", "publish-received"].includes(journal?.status);
    const report = await validateManifest(manifest, manifestPath, config, { allowStaleSource: recovering });
    if (!report.passed) throw new Error(`Refusing to publish ${manifest.id}; validation failed.`);

    const manualTypes = config.publishing?.manualReviewTypes || [];
    const autoTypes = config.publishing?.autoPublishTypes || [];
    const contentType = manifest.creative.contentType;
    const expectedPolicy = manualTypes.includes(contentType)
      ? "manual"
      : autoTypes.includes(contentType)
        ? "automatic-after-validation"
        : null;
    if (!expectedPolicy || manifest.approval?.policy !== expectedPolicy) {
      throw new Error(`Manifest review policy is invalid for ${contentType}.`);
    }
    if (expectedPolicy === "manual" && !args["manual-approved"]) {
      throw new Error("This content type requires --manual-approved in addition to --confirm.");
    }

    const ledgerEntries = await readJsonLines(LEDGER_PATH);
    const completedEntry = ledgerEntries.find(
      (entry) => entry.platform === "instagram" && entry.postId === manifest.id && entry.mediaId && entry.permalink,
    );
    if (completedEntry) {
      manifest.status = "published";
      manifest.publishing = {
        ...manifest.publishing,
        status: "published",
        mediaId: completedEntry.mediaId,
        permalink: completedEntry.permalink,
        publishedAt: completedEntry.publishedAt,
        instagram: {
          status: "published",
          mediaId: completedEntry.mediaId,
          permalink: completedEntry.permalink,
          publishedAt: completedEntry.publishedAt,
        },
      };
      await atomicWriteJson(manifestPath, manifest);
      if (journal) {
        journal = {
          ...journal,
          status: "live-verified",
          mediaId: completedEntry.mediaId,
          permalink: completedEntry.permalink,
          publishedAt: completedEntry.publishedAt,
        };
        await atomicWriteJson(journalPath, journal);
      }
      console.log(JSON.stringify({
        postId: manifest.id,
        status: "already-published",
        mediaId: completedEntry.mediaId,
        permalink: completedEntry.permalink,
      }, null, 2));
      return;
    }

    if (manifest.status !== "staged") {
      throw new Error(`Refusing to publish ${manifest.id}; run the staging gate first.`);
    }

    const manifestDigest = sha256(JSON.stringify(manifest));
    const accountIdHash = sha256(accountId);
    if (journal) {
      if (journal.postId !== manifest.id || journal.manifestSha256 !== manifestDigest) {
        throw new Error(`Publication journal for ${manifest.id} does not match the staged manifest.`);
      }
      if (journal.accountIdHash !== accountIdHash) {
        throw new Error(`Publication journal for ${manifest.id} belongs to a different Instagram account.`);
      }
    } else {
      journal = {
        schemaVersion: 1,
        postId: manifest.id,
        status: "prepared",
        accountIdHash,
        manifestSha256: manifestDigest,
        children: [],
        carouselId: null,
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
    await verifyAccountIdentity(manifest);

    if (journal.status === "publish-requesting") {
      const reconciled = await reconcileAmbiguousPublish(journal, manifest, orderedSlides);
      if (!reconciled) {
        throw new Error(
          `Instagram publish outcome remains ambiguous. Journal preserved at ${relative(PROJECT_ROOT, journalPath)}; publication will not be retried.`,
        );
      }
      journal.status = "publish-received";
      journal.mediaId = reconciled.id;
      journal.receivedAt = new Date().toISOString();
      await saveJournal();
    }

    if (!journal.mediaId) {
      await verifyPublishingQuota();

      for (const slide of orderedSlides) {
        let child = journal.children.find((entry) => entry.order === slide.order);
        if (!child) {
          const created = await graph(`/${accountId}/media`, {
            method: "POST",
            fields: {
              image_url: slide.publicUrl,
              is_carousel_item: "true",
              alt_text: slide.altText,
            },
          });
          if (!created.id) throw new Error(`Instagram did not return a container ID for slide ${slide.order}.`);
          child = { order: slide.order, id: created.id };
          journal.children.push(child);
          journal.children.sort((left, right) => left.order - right.order);
          journal.status = "creating-containers";
          await saveJournal();
        }
        await waitForContainer(child.id);
      }

      if (!journal.carouselId) {
        const carousel = await graph(`/${accountId}/media`, {
          method: "POST",
          fields: {
            media_type: "CAROUSEL",
            children: journal.children.map((child) => child.id).join(","),
            caption: manifest.creative.caption,
            ...(manifest.creative.discovery?.locationTag?.instagramLocationId
              ? { location_id: manifest.creative.discovery.locationTag.instagramLocationId }
              : {}),
          },
        });
        if (!carousel.id) throw new Error("Instagram did not return a carousel container ID.");
        journal.carouselId = carousel.id;
        journal.status = "carousel-created";
        await saveJournal();
      }
      await waitForContainer(journal.carouselId);
      journal.status = "publish-requesting";
      journal.requestedAt = new Date().toISOString();
      await saveJournal();

      let published;
      try {
        published = await graph(`/${accountId}/media_publish`, {
          method: "POST",
          fields: { creation_id: journal.carouselId },
        });
      } catch (error) {
        throw new Error(
          `${error.message} Publish outcome is ambiguous; rerun to reconcile ${relative(PROJECT_ROOT, journalPath)} without republishing.`,
        );
      }
      if (!published.id) {
        throw new Error("Instagram did not return a published media ID; outcome is ambiguous and will not be retried.");
      }
      journal.status = "publish-received";
      journal.mediaId = published.id;
      journal.receivedAt = new Date().toISOString();
      await saveJournal();
    }

    const live = await readAndVerifyLive(journal.mediaId, manifest, orderedSlides);
    const publishedAt = live.timestamp || new Date().toISOString();
    const ledgerEntry = {
      schemaVersion: 1,
      event: "live-verified",
      postId: manifest.id,
      platform: "instagram",
      accountIdHash,
      mediaId: live.id,
      permalink: live.permalink,
      publishedAt,
      manifestSha256: manifestDigest,
    };
    await mkdir(dirname(LEDGER_PATH), { recursive: true });
    await appendFile(LEDGER_PATH, `${JSON.stringify(ledgerEntry)}\n`, { encoding: "utf8", mode: 0o600 });

    manifest.status = "published";
    manifest.publishing = {
      ...manifest.publishing,
      status: "published",
      mediaId: live.id,
      permalink: live.permalink,
      publishedAt,
      instagram: {
        status: "published",
        mediaId: live.id,
        permalink: live.permalink,
        publishedAt,
      },
    };
    await atomicWriteJson(manifestPath, manifest);
    journal.status = "live-verified";
    journal.mediaId = live.id;
    journal.permalink = live.permalink;
    journal.publishedAt = publishedAt;
    await saveJournal();

    console.log(JSON.stringify({
      postId: manifest.id,
      status: "published",
      mediaId: live.id,
      permalink: live.permalink,
    }, null, 2));
  } finally {
    await releaseLock();
  }
}

await runPublisher();
