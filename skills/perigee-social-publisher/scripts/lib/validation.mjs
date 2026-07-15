import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import sharp from "sharp";
import { createGenerationBrief, DESIGN_SYSTEM_VERSION, IMAGE_GENERATOR, LEGACY_DESIGN_SYSTEM_VERSION } from "./design-system.mjs";
import { PROJECT_ROOT } from "./paths.mjs";
import { sha256, sha256File } from "./utils.mjs";

function check(name, passed, detail) {
  return { name, passed: Boolean(passed), detail };
}

export async function validateManifest(manifest, manifestPath, config, { allowStaleSource = false } = {}) {
  const checks = [];
  const errors = [];
  const push = (entry) => {
    checks.push(entry);
    if (!entry.passed) errors.push(`${entry.name}: ${entry.detail}`);
  };

  push(check("schema", [1, 2, 3].includes(manifest.schemaVersion), "Manifest schemaVersion must be 1, 2, or 3."));
  push(check("status", ["awaiting-artwork", "awaiting-generation", "draft", "validated", "staged", "published"].includes(manifest.status), "Unknown manifest status."));
  push(check("provider-match", manifest.sources?.matched === true, "Perigee and NOAA digests must match."));
  push(check("provider-digests", manifest.sources?.noaa?.sha256 === manifest.sources?.perigee?.sha256, "Provider digests differ."));
  push(check("prediction-count", Array.isArray(manifest.data?.predictions) && manifest.data.predictions.length >= 8, "Expected at least eight high/low predictions."));

  const highs = (manifest.data?.predictions || []).filter((prediction) => prediction.type === "H");
  const computedHighest = highs.reduce((best, prediction) => (!best || prediction.v > best.v ? prediction : best), null);
  push(check("highest-value", computedHighest && computedHighest.v === manifest.data?.metrics?.highest?.v, "Derived highest prediction does not match source data."));
  push(check("threshold", manifest.data?.metrics?.thresholdFt === manifest.station?.kingTideThresholdFt, "Manifest threshold differs from the checked-in almanac."));

  const caption = manifest.creative?.caption || "";
  const contentType = manifest.creative?.contentType;
  const manualReviewTypes = config.publishing?.manualReviewTypes || [];
  const autoPublishTypes = config.publishing?.autoPublishTypes || [];
  const requiresManualReview = manualReviewTypes.includes(contentType);
  const allowsAutomaticReview = autoPublishTypes.includes(contentType);
  const contentTypeKnown = requiresManualReview !== allowsAutomaticReview;
  const expectedApprovalPolicy = requiresManualReview
    ? "manual"
    : allowsAutomaticReview
      ? "automatic-after-validation"
      : null;
  push(check("content-type-policy", contentTypeKnown, "Content type must belong to exactly one review policy."));
  push(check(
    "approval-policy",
    contentTypeKnown && manifest.approval?.policy === expectedApprovalPolicy,
    `Approval policy must be ${expectedApprovalPolicy || "configured"} for ${contentType || "unknown content"}.`,
  ));
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
  push(check(
    "slide-order",
    JSON.stringify(slides.map((slide) => slide.order)) === JSON.stringify([1, 2, 3, 4, 5]),
    "Carousel slides must be unique and ordered exactly 1 through 5.",
  ));
  const manifestDir = dirname(resolve(manifestPath));
  let generationBrief = null;
  if (manifest.schemaVersion === 2) {
    const artwork = manifest.creative?.artwork;
    push(check("design-system", manifest.creative?.designSystemVersion === LEGACY_DESIGN_SYSTEM_VERSION, `Legacy schema 2 manifest must use ${LEGACY_DESIGN_SYSTEM_VERSION}.`));
    push(check("artwork-generated-by", artwork?.generatedBy === "codex", "Editorial artwork must be generated by Codex."));
    push(check("artwork-generator", artwork?.generator === IMAGE_GENERATOR && artwork?.mode === "built-in", "Editorial artwork must use Codex built-in image generation."));
    push(check("artwork-non-factual", artwork?.embeddedFactualContent === false, "Generated artwork must not contain factual text, charts, maps, labels, or marks."));
    push(check("artwork-reviewed", artwork?.reviewedAgainstBrief === true, "Generated artwork must be inspected against the visual brief."));
    const artworkPath = resolve(PROJECT_ROOT, artwork?.file || "");
    const insideArtworkDir = artworkPath.startsWith(`${resolve(manifestDir, "artwork")}${sep}`);
    push(check("artwork-path", insideArtworkDir, "Generated artwork must live below the post artwork directory."));
    try {
      const [metadata, digest] = await Promise.all([sharp(artworkPath).metadata(), sha256File(artworkPath)]);
      push(check("artwork-format", ["jpeg", "png", "webp"].includes(metadata.format), "Artwork must be JPEG, PNG, or WebP."));
      push(check("artwork-size", (metadata.width || 0) >= 1000 && (metadata.height || 0) >= 1000, "Artwork must be at least 1000×1000px."));
      push(check("artwork-digest", digest === artwork?.sha256, "Artwork checksum changed after attachment."));
      push(check("artwork-metadata", metadata.width === artwork?.width && metadata.height === artwork?.height && metadata.format === artwork?.format, "Artwork metadata differs from the manifest."));
    } catch (error) {
      push(check("artwork-readable", false, `Could not read artwork: ${error.message}`));
    }
  }
  if (manifest.schemaVersion === 3) {
    push(check("design-system", manifest.creative?.designSystemVersion === DESIGN_SYSTEM_VERSION, `Manifest must use ${DESIGN_SYSTEM_VERSION}.`));
    push(check("no-background-artwork", manifest.creative?.artwork == null, "Full-generation manifests must not attach separate background artwork."));
    const briefPath = resolve(manifestDir, manifest.creative?.generationBrief || "generation-brief.json");
    const insideManifest = briefPath.startsWith(`${manifestDir}${sep}`);
    push(check("generation-brief-path", insideManifest, "Generation brief must live beside the manifest."));
    try {
      generationBrief = JSON.parse(await readFile(briefPath, "utf8"));
      push(check("generation-brief-post", generationBrief.postId === manifest.id, "Generation brief post ID differs from the manifest."));
      push(check("generation-brief-design", generationBrief.designSystemVersion === DESIGN_SYSTEM_VERSION, "Generation brief design system is stale."));
      push(check("generation-brief-generator", generationBrief.requiredGenerator?.generatedBy === "codex" && generationBrief.requiredGenerator?.generator === IMAGE_GENERATOR && generationBrief.requiredGenerator?.mode === "built-in", "Generation brief must require Codex built-in image generation."));
      push(check("generation-brief-slide-count", generationBrief.slides?.length === 5, "Generation brief must contain five complete-slide prompts."));
      push(check("generation-brief-no-overlays", generationBrief.output?.deterministicOverlaysAllowed === false, "Generation brief must prohibit deterministic overlays and compositing."));
      const expectedBrief = createGenerationBrief(manifest, config);
      push(check("generation-brief-facts", generationBrief.factsSha256 === expectedBrief.factsSha256, "Generation brief facts differ from the current frozen manifest."));
      push(check(
        "generation-brief-prompts",
        JSON.stringify(generationBrief.slides?.map(({ prompt }) => prompt)) === JSON.stringify(expectedBrief.slides.map(({ prompt }) => prompt)),
        "Generation brief prompts differ from the current frozen manifest and design system.",
      ));
    } catch (error) {
      push(check("generation-brief-readable", false, `Could not read generation brief: ${error.message}`));
    }
  }
  for (const slide of slides) {
    const slidePath = resolve(PROJECT_ROOT, slide.file || "");
    const insidePost = slidePath.startsWith(`${manifestDir}${sep}`);
    push(check(`slide-${slide.order}-path`, insidePost, "Slide must live below its manifest directory."));
    if (manifest.schemaVersion === 3) {
      const prompt = generationBrief?.slides?.[slide.order - 1]?.prompt;
      push(check(`slide-${slide.order}-generated-by`, slide.generatedBy === "codex", "Finished slide must be generated by Codex."));
      push(check(`slide-${slide.order}-generator`, slide.generator === IMAGE_GENERATOR && slide.mode === "built-in", "Finished slide must use Codex built-in image generation."));
      push(check(`slide-${slide.order}-factual-content`, slide.embeddedFactualContent === true, "Finished generated slide must include its factual presentation and visible copy."));
      push(check(`slide-${slide.order}-reviewed`, slide.reviewedAgainstBrief === true, "Codex must inspect the finished slide against its exact prompt and data."));
      push(check(`slide-${slide.order}-prompt`, typeof prompt === "string" && slide.promptSha256 === sha256(prompt), "Slide prompt hash differs from the frozen generation brief."));
      push(check(`slide-${slide.order}-no-compositing`, slide.normalization === "orientation-resize-jpeg-only; no overlays or compositing", "Only image orientation, sizing, and JPEG normalization are allowed after generation."));
      push(check(`slide-${slide.order}-source-digest`, /^[a-f0-9]{64}$/.test(slide.sourceSha256 || ""), "Generated source image checksum is missing."));
    }
    try {
      const [metadata, digest] = await Promise.all([sharp(slidePath).metadata(), sha256File(slidePath)]);
      push(check(`slide-${slide.order}-format`, metadata.format === "jpeg", "Slide must be JPEG."));
      push(check(`slide-${slide.order}-size`, metadata.width === config.publishing.width && metadata.height === config.publishing.height, `Slide must be ${config.publishing.width}×${config.publishing.height}.`));
      push(check(`slide-${slide.order}-digest`, digest === slide.sha256, "Slide checksum changed after attachment."));
      push(check(`slide-${slide.order}-alt`, typeof slide.altText === "string" && slide.altText.length >= 40 && slide.altText.length <= 1000, "Alt text must be 40–1000 characters."));
    } catch (error) {
      push(check(`slide-${slide.order}-readable`, false, `Could not read slide: ${error.message}`));
    }
  }

  const generatedAt = Date.parse(manifest.generatedAt || "");
  const fetchedAt = Date.parse(manifest.sources?.fetchedAt || "");
  push(check("generated-at", Number.isFinite(generatedAt) && generatedAt <= Date.now() + 300000, "generatedAt is invalid or in the future."));
  push(check(
    "fresh-source",
    Number.isFinite(fetchedAt) && (allowStaleSource || Date.now() - fetchedAt <= 21600000),
    allowStaleSource
      ? "Prediction timestamp must remain valid during publication recovery."
      : "Prediction data is more than six hours old.",
  ));

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
