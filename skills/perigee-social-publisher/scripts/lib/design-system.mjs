import { mkdir, rename, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import sharp from "sharp";
import { PROJECT_ROOT } from "./paths.mjs";
import { formatStationLocal, sha256, sha256File } from "./utils.mjs";

export const DESIGN_SYSTEM_VERSION = "perigee-feed-v2-full-generation";
export const LEGACY_DESIGN_SYSTEM_VERSION = "perigee-feed-v1";
export const IMAGE_GENERATOR = "openai-imagegen-built-in";

const SLIDE_NAMES = ["01-cover.jpg", "02-peak.jpg", "03-curve.jpg", "04-meaning.jpg", "05-source.jpg"];

function peakFor(manifest) {
  const cluster = manifest.data?.kingTideCluster;
  if (cluster) {
    return {
      value: cluster.peakHeight,
      dateLabel: formatStationLocal(`${cluster.peakDateKey} ${toTwentyFourHour(cluster.peakTimeLabel)}`).dateLabel,
      timeLabel: cluster.peakTimeLabel,
    };
  }
  return {
    value: manifest.data.metrics.highest.v,
    dateLabel: manifest.data.metrics.highest.dateLabel,
    timeLabel: manifest.data.metrics.highest.timeLabel,
  };
}

function sharedPrompt(manifest, config, order) {
  return [
    "Use case: infographic-diagram",
    `Asset type: finished Instagram carousel slide ${order} of 5, portrait 4:5`,
    "Primary request: generate the entire finished Perigee Tides slide in one image, including the editorial background, typography, data presentation, chart or information design, hierarchy, spacing, and all visible copy.",
    `Brand: premium coastal field guide; deep ocean ink ${config.brand.palette.inkDark}, warm foam ${config.brand.palette.paper}, tide teal ${config.brand.palette.tide}, signal magenta ${config.brand.palette.magenta}, threshold brass ${config.brand.palette.brass}; sophisticated editorial photography and information design.`,
    "Composition: 1080x1350 portrait intent; keep every critical character and data mark inside 90-pixel side and 100-pixel top/bottom safe areas; generous negative space; strong asymmetry; clear swipe-sequence continuity.",
    "Typography: elegant high-contrast editorial serif for the main headline or hero value, clean modern sans serif for labels and factual copy; excellent kerning; large mobile-readable type; high contrast.",
    "Accuracy: render every string in the EXACT TEXT block verbatim, including capitalization, punctuation, decimal precision, station ID, datum, and time. Do not add, omit, paraphrase, or misspell text. If any character is wrong, the image fails review.",
    "Data boundary: depict astronomical predictions only. Do not imply an observation, live condition, flood forecast, safety status, weather event, or recognizable station geography.",
    "Constraints: no logos other than the words Perigee Tides, no NOAA seal, no provider marks, no map, no watermark, no fake UI, no engagement bait, no sensational weather, no stock-template appearance.",
    `Continuity key: ${manifest.id}; slide ${order} of 5.`,
  ].join("\n");
}

function exactTextBlock(lines) {
  return ["EXACT TEXT — reproduce only these strings:", ...lines.map((line) => `\"${line}\"`)].join("\n");
}

function predictionSeries(manifest) {
  return manifest.data.predictions.map((prediction) => {
    const local = formatStationLocal(prediction.t);
    return `${local.dateLabel} | ${local.timeLabel} | ${prediction.type === "H" ? "high" : "low"} | ${prediction.v.toFixed(3)} ft MLLW`;
  });
}

function slideSpecs(manifest, config) {
  const peak = peakFor(manifest);
  const isKingTide = manifest.creative.contentType === "king-tide-prediction";
  const highest = manifest.data.metrics.highest;
  const lowest = manifest.data.metrics.lowest;
  const threshold = manifest.data.metrics.thresholdFt;
  const commonStation = `${manifest.station.displayName} · NOAA ${manifest.station.id}`;
  const stationTime = "Station-local time · feet above local MLLW";
  const predictionData = predictionSeries(manifest);
  const topHighs = manifest.data.predictions
    .filter((prediction) => prediction.type === "H")
    .sort((left, right) => right.v - left.v)
    .slice(0, 3)
    .map((prediction) => {
      const local = formatStationLocal(prediction.t);
      return `${local.dateLabel.replace(/, \d{4}$/, "")} · ${local.timeLabel} · ${prediction.v.toFixed(3)} ft`;
    });

  const slides = [
    {
      order: 1,
      role: "hook",
      exactText: [
        "PERIGEE TIDES",
        manifest.creative.eyebrow,
        manifest.creative.headline,
        `Predicted high · ${peak.value.toFixed(2)} ft`,
        `${peak.timeLabel} · ${peak.dateLabel}`,
        commonStation,
        "1 / 5",
      ],
      direction: "Create a cinematic but non-documentary ocean study as part of the complete poster. Make the headline and predicted high the immediate focal points. The water is editorial atmosphere, never evidence of local conditions.",
    },
    {
      order: 2,
      role: "primary-fact",
      exactText: [
        "PREDICTED HIGH",
        `${peak.value.toFixed(2)} ft`,
        "above local MLLW",
        peak.timeLabel,
        peak.dateLabel,
        commonStation,
        stationTime,
        "Astronomical prediction",
        "2 / 5",
      ],
      direction: "Build a refined data card with the hero value dominating the slide. Integrate subtle generated water texture, contour motifs, and editorial lighting without obscuring a single character.",
    },
    {
      order: 3,
      role: "prediction-series",
      exactText: [
        "7-DAY TIDE OUTLOOK",
        commonStation,
        "Matched NOAA + Perigee astronomical predictions",
        stationTime,
        ...(isKingTide ? [`Perigee top-1% threshold · ${threshold.toFixed(3)} ft`] : []),
        "3 / 5",
      ],
      direction: `Create a precise, legible tide-curve infographic from only the supplied DATA SERIES. Plot every point in chronological order. Distinguish highs and lows by both shape and color; do not invent or smooth away data. ${isKingTide ? "Include a clearly labeled horizontal threshold at the exact supplied value." : "Emphasize the weekly range without adding a threshold."}\nDATA SERIES — plot exactly:\n${predictionData.join("\n")}`,
      dataSeries: predictionData,
    },
    isKingTide
      ? {
          order: 4,
          role: "meaning",
          exactText: [
            "WHY IT MATTERS",
            "Perigee's station-specific definition",
            "TOP 1%",
            "of this station's predicted annual highs",
            `2026 threshold · ${threshold.toFixed(3)} ft MLLW`,
            ...topHighs,
            "NOAA does not define one universal king-tide threshold.",
            "4 / 5",
          ],
          direction: "Create an editorial explainer with TOP 1% as the visual anchor and the three exact nearby predicted highs as a clean ranked list. Keep the station-specific definition unmistakable.",
        }
      : {
          order: 4,
          role: "meaning",
          exactText: [
            "WEEKLY RANGE",
            `${manifest.data.metrics.rangeFt.toFixed(2)} ft`,
            `Highest prediction · ${highest.v.toFixed(2)} ft`,
            `${highest.timeLabel} · ${highest.dateLabel}`,
            `Lowest prediction · ${lowest.v.toFixed(2)} ft`,
            `${lowest.timeLabel} · ${lowest.dateLabel}`,
            stationTime,
            commonStation,
            "4 / 5",
          ],
          direction: "Create a clear highest-versus-lowest comparison with the weekly range as the hero number. Use both position and color to distinguish the two predictions.",
        },
    {
      order: 5,
      role: "source-and-action",
      exactText: [
        "SOURCE + LIMITS",
        "Prediction ≠ observation",
        "Astronomical prediction at one NOAA station",
        "Not an observed water level or flood forecast",
        "Wind, pressure, waves and rain can move observed water",
        manifest.creative.ctaLabel || (isKingTide ? "EXPLORE THE FULL CALENDAR" : "OPEN THE FULL STATION CHART"),
        manifest.creative.ctaDisplay,
        "NOAA CO-OPS",
        manifest.creative.disclaimer,
        "5 / 5",
      ],
      direction: "Create a calm source-and-limitations finish card. Make Prediction ≠ observation and the action line prominent while keeping the full disclaimer comfortably readable.",
    },
  ];

  return slides.map((slide) => ({
    ...slide,
    outputFile: SLIDE_NAMES[slide.order - 1],
    prompt: [sharedPrompt(manifest, config, slide.order), slide.direction, exactTextBlock(slide.exactText)].join("\n\n"),
    reviewChecklist: [
      "Every EXACT TEXT string is present verbatim and no other factual text appears.",
      "Every number, time, date, station identifier, datum label, and chart point agrees with the frozen brief.",
      "No text or critical data is clipped, warped, illegible, or outside the safe area.",
      "The image is one complete generated slide with no deterministic overlay or composited background.",
      "The slide does not imply observed conditions, flooding, weather, safety, or recognizable station geography.",
    ],
  }));
}

export function createGenerationBrief(manifest, config) {
  const slides = slideSpecs(manifest, config);
  const facts = {
    station: manifest.station,
    contentType: manifest.creative.contentType,
    predictions: manifest.data.predictions,
    metrics: manifest.data.metrics,
    kingTideCluster: manifest.data.kingTideCluster,
    slideText: slides.map(({ order, exactText }) => ({ order, exactText })),
  };

  return {
    schemaVersion: 2,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    promptVersion: `${DESIGN_SYSTEM_VERSION}-carousel-v1`,
    postId: manifest.id,
    createdAt: new Date().toISOString(),
    requiredGenerator: {
      generatedBy: "codex",
      generator: IMAGE_GENERATOR,
      mode: "built-in",
    },
    output: {
      role: "five-complete-carousel-slides",
      count: 5,
      targetAspectRatio: "4:5",
      targetWidth: config.publishing.width,
      targetHeight: config.publishing.height,
      publicationFormat: "jpeg",
      generatedContentIncludes: ["background", "typography", "data", "chart", "information-design", "all-visible-copy"],
      deterministicOverlaysAllowed: false,
    },
    facts,
    factsSha256: sha256(JSON.stringify(facts)),
    slides,
  };
}

export async function attachGeneratedSlides({ manifest, manifestPath, slidePaths, brief, config }) {
  if (!Array.isArray(slidePaths) || slidePaths.length !== 5 || slidePaths.some((path) => !path)) {
    throw new Error("Pass all five Codex-generated images with --slide-1 through --slide-5.");
  }

  const slidesDir = resolve(manifestPath, "..", "slides");
  await mkdir(slidesDir, { recursive: true });
  const attached = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const source = resolve(PROJECT_ROOT, slidePaths[index]);
    const metadata = await sharp(source).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new Error(`Slide ${index + 1} image output must be JPEG, PNG, or WebP.`);
    }
    if ((metadata.width || 0) < 768 || (metadata.height || 0) < 960) {
      throw new Error(`Slide ${index + 1} image output is too small for a 1080×1350 feed asset.`);
    }
    const sourceSha256 = await sha256File(source);

    const spec = brief.slides[index];
    if (spec.order !== index + 1) throw new Error("Generation brief slide order is invalid.");
    const destination = resolve(slidesDir, SLIDE_NAMES[index]);
    const temporaryDestination = `${destination}.${process.pid}.tmp.jpg`;
    try {
      await sharp(source)
        .rotate()
        .resize(config.publishing.width, config.publishing.height, { fit: "fill" })
        .jpeg({ quality: config.publishing.jpegQuality, chromaSubsampling: "4:4:4" })
        .toFile(temporaryDestination);
      await rename(temporaryDestination, destination);
    } finally {
      await rm(temporaryDestination, { force: true });
    }

    attached.push({
      order: index + 1,
      role: spec.role,
      file: relative(PROJECT_ROOT, destination),
      altText: manifest.creative.altTexts[index],
      sha256: await sha256File(destination),
      generatedBy: "codex",
      generator: IMAGE_GENERATOR,
      mode: "built-in",
      promptVersion: brief.promptVersion,
      promptSha256: sha256(spec.prompt),
      sourceSha256,
      sourceFormat: metadata.format,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      embeddedFactualContent: true,
      reviewedAgainstBrief: true,
      normalization: "orientation-resize-jpeg-only; no overlays or compositing",
      attachedAt: new Date().toISOString(),
    });
  }

  return attached;
}

function toTwentyFourHour(timeLabel) {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(timeLabel);
  if (!match) throw new Error(`Invalid 12-hour time: ${timeLabel}`);
  let hour = Number(match[1]);
  if (match[3] === "AM" && hour === 12) hour = 0;
  if (match[3] === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}
