import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import sharp from "sharp";
import { PROJECT_ROOT } from "./paths.mjs";
import { sha256File } from "./utils.mjs";

function check(name, passed, detail) {
  return { name, passed: Boolean(passed), detail };
}

export async function validateManifest(manifest, manifestPath, config) {
  const checks = [];
  const errors = [];
  const push = (entry) => {
    checks.push(entry);
    if (!entry.passed) errors.push(`${entry.name}: ${entry.detail}`);
  };

  push(check("schema", manifest.schemaVersion === 1, "Manifest schemaVersion must be 1."));
  push(check("status", ["draft", "validated", "staged", "published"].includes(manifest.status), "Unknown manifest status."));
  push(check("provider-match", manifest.sources?.matched === true, "Perigee and NOAA digests must match."));
  push(check("provider-digests", manifest.sources?.noaa?.sha256 === manifest.sources?.perigee?.sha256, "Provider digests differ."));
  push(check("prediction-count", Array.isArray(manifest.data?.predictions) && manifest.data.predictions.length >= 8, "Expected at least eight high/low predictions."));

  const highs = (manifest.data?.predictions || []).filter((prediction) => prediction.type === "H");
  const computedHighest = highs.reduce((best, prediction) => (!best || prediction.v > best.v ? prediction : best), null);
  push(check("highest-value", computedHighest && computedHighest.v === manifest.data?.metrics?.highest?.v, "Derived highest prediction does not match source data."));
  push(check("threshold", manifest.data?.metrics?.thresholdFt === manifest.station?.kingTideThresholdFt, "Manifest threshold differs from the checked-in almanac."));

  const caption = manifest.creative?.caption || "";
  const requiredTerms = ["prediction", "MLLW", manifest.station?.id, "NOAA", "not for navigation"];
  for (const term of requiredTerms) {
    push(check(`caption-${String(term).toLowerCase().replaceAll(" ", "-")}`, caption.toLowerCase().includes(String(term).toLowerCase()), `Caption must include “${term}”.`));
  }
  const prohibited = /\b(safe|unsafe|all clear|guaranteed|real-time|navigation-grade|perfect conditions)\b/i;
  push(check("prohibited-claims", !prohibited.test(caption), "Caption contains a prohibited claim."));
  push(check("caption-length", caption.length > 0 && caption.length <= 2200, "Caption must be 1–2200 characters."));

  let ctaValid = false;
  try {
    const url = new URL(manifest.creative?.ctaUrl);
    ctaValid = url.protocol === "https:" && url.hostname === "perigeetides.com" && url.searchParams.get("utm_source") === "instagram";
  } catch {
    ctaValid = false;
  }
  push(check("cta", ctaValid, "CTA must be an attributed perigeetides.com HTTPS URL."));

  const serialized = JSON.stringify(manifest);
  const secretPattern = /(IGQV[A-Za-z0-9_-]{20,}|EAA[A-Za-z0-9_-]{20,}|access[_-]?token\s*["':=]+\s*[A-Za-z0-9_-]{12,}|app[_-]?secret\s*["':=]+\s*[A-Za-z0-9_-]{12,})/i;
  push(check("no-secrets", !secretPattern.test(serialized), "Manifest appears to contain an access token or app secret."));

  const slides = manifest.creative?.slides || [];
  push(check("slide-count", slides.length === 5, "Instagram carousel must contain five slides."));
  const manifestDir = dirname(resolve(manifestPath));
  for (const slide of slides) {
    const slidePath = resolve(PROJECT_ROOT, slide.file || "");
    const insidePost = slidePath.startsWith(`${manifestDir}${sep}`);
    push(check(`slide-${slide.order}-path`, insidePost, "Slide must live below its manifest directory."));
    try {
      const [metadata, digest] = await Promise.all([sharp(slidePath).metadata(), sha256File(slidePath)]);
      push(check(`slide-${slide.order}-format`, metadata.format === "jpeg", "Slide must be JPEG."));
      push(check(`slide-${slide.order}-size`, metadata.width === config.publishing.width && metadata.height === config.publishing.height, `Slide must be ${config.publishing.width}×${config.publishing.height}.`));
      push(check(`slide-${slide.order}-digest`, digest === slide.sha256, "Slide checksum changed after render."));
      push(check(`slide-${slide.order}-alt`, typeof slide.altText === "string" && slide.altText.length >= 40 && slide.altText.length <= 1000, "Alt text must be 40–1000 characters."));
    } catch (error) {
      push(check(`slide-${slide.order}-readable`, false, `Could not read slide: ${error.message}`));
    }
  }

  const generatedAt = Date.parse(manifest.generatedAt || "");
  const fetchedAt = Date.parse(manifest.sources?.fetchedAt || "");
  push(check("generated-at", Number.isFinite(generatedAt) && generatedAt <= Date.now() + 300000, "generatedAt is invalid or in the future."));
  push(check("fresh-source", Number.isFinite(fetchedAt) && Date.now() - fetchedAt <= 21600000, "Prediction data is more than six hours old."));

  const report = {
    schemaVersion: 1,
    postId: manifest.id,
    validatedAt: new Date().toISOString(),
    passed: errors.length === 0,
    checks,
    errors,
  };
  return report;
}

export async function readManifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
