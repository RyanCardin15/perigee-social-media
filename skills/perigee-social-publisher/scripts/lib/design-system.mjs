import { copyFile, mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import sharp from "sharp";
import { PROJECT_ROOT } from "./paths.mjs";
import { formatStationLocal, sha256, sha256File } from "./utils.mjs";

export const DESIGN_SYSTEM_VERSION = "perigee-feed-v1";
export const IMAGE_GENERATOR = "openai-imagegen-built-in";

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

function isNight(timeLabel) {
  const match = /^(\d{1,2}):\d{2} (AM|PM)$/.exec(timeLabel || "");
  if (!match) return false;
  let hour = Number(match[1]) % 12;
  if (match[2] === "PM") hour += 12;
  return hour >= 19 || hour < 6;
}

export function createVisualBrief(manifest, config) {
  const peak = peakFor(manifest);
  const night = isNight(peak.timeLabel);
  const signal = manifest.creative.contentType === "king-tide-prediction" ? "king-tide signal" : "weekly tide outlook";
  const prompt = [
    "Use case: ads-marketing",
    "Asset type: Instagram carousel editorial background, portrait 4:5",
    `Primary request: create an arresting, premium editorial ocean image for Perigee Tides' ${signal}. Use the verified data only to set the emotional register: a predicted high of ${peak.value.toFixed(3)} ft above local MLLW at ${peak.timeLabel} on ${peak.dateLabel}, at one NOAA station.`,
    "Scene/backdrop: an abstract, close coastal-water study with sculptural tidal folds and a clear sense of vertical movement; metaphorical and non-documentary, never a depiction of current or forecast conditions",
    "Subject: ocean surface and luminous water texture only",
    "Style/medium: sophisticated editorial photography blended with restrained fine-art realism; tactile, cinematic, contemporary, highly polished",
    "Composition/framing: portrait 4:5; strong focal texture in the upper-right and lower half; preserve calm negative space through the upper-left and center-left for deterministic headline overlay; crop-safe edge detail",
    `Lighting/mood: ${night ? "deep moonlit atmosphere with a controlled silver glow" : "soft coastal daylight with a controlled pearlescent glow"}; compelling and calm, never ominous or sensational`,
    `Color palette: deep ink ${config.brand.palette.inkDark || "#071d2a"}, ocean teal ${config.brand.palette.tide}, warm foam ${config.brand.palette.paper}, tiny controlled glints of signal magenta ${config.brand.palette.magenta}`,
    "Materials/textures: real water microtexture, translucent folds, subtle grain, crisp highlights, rich shadow detail",
    "Constraints: absolutely no text, numbers, letters, logos, marks, labels, charts, axes, maps, landmarks, boats, people, animals, buildings, flooding, storm damage, warnings, or recognizable geography; no watermark; this is an editorial metaphor, not evidence",
    "Avoid: generic stock sunset, tropical turquoise, giant wave, disaster imagery, fantasy seascape, lens flare, oversaturation, symmetrical poster layout, fake UI",
  ].join("\n");

  const facts = {
    stationId: manifest.station.id,
    stationName: manifest.station.displayName,
    contentType: manifest.creative.contentType,
    predictedHighFtMllw: Number(peak.value.toFixed(3)),
    predictedHighDate: peak.dateLabel,
    predictedHighTime: peak.timeLabel,
    stationLocalTime: true,
    predictionNotObservation: true,
  };

  return {
    schemaVersion: 1,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    promptVersion: `${DESIGN_SYSTEM_VERSION}-editorial-ocean-v1`,
    postId: manifest.id,
    createdAt: new Date().toISOString(),
    requiredGenerator: {
      generatedBy: "codex",
      generator: IMAGE_GENERATOR,
      mode: "built-in",
    },
    asset: {
      role: "editorial-background",
      targetAspectRatio: "4:5",
      targetWidth: config.publishing.width,
      targetHeight: config.publishing.height,
      minimumWidth: 1000,
      minimumHeight: 1000,
      embeddedFactualContent: false,
    },
    facts,
    factsSha256: sha256(JSON.stringify(facts)),
    prompt,
    reviewChecklist: [
      "No embedded text, numbers, logos, charts, maps, landmarks, or provider marks.",
      "No visual claim of flooding, weather, observed water level, or actual local conditions.",
      "Enough quiet negative space remains for deterministic headline composition.",
      "The palette and finish match Perigee Feed System v1.",
    ],
  };
}

export async function attachGeneratedArtwork({ manifest, manifestPath, artworkPath, brief }) {
  if (!artworkPath) throw new Error("Pass --artwork <path> to a Codex-generated image.");
  const absoluteSource = resolve(PROJECT_ROOT, artworkPath);
  const metadata = await sharp(absoluteSource).metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("Artwork must be JPEG, PNG, or WebP.");
  }
  if ((metadata.width || 0) < brief.asset.minimumWidth || (metadata.height || 0) < brief.asset.minimumHeight) {
    throw new Error(`Artwork must be at least ${brief.asset.minimumWidth}×${brief.asset.minimumHeight}px.`);
  }
  const extension = metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const postDir = resolve(manifestPath, "..");
  const artworkDir = resolve(postDir, "artwork");
  const destination = resolve(artworkDir, `editorial-source${extension}`);
  await mkdir(artworkDir, { recursive: true });
  if (absoluteSource !== destination) await copyFile(absoluteSource, destination);

  return {
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    promptVersion: brief.promptVersion,
    generatedBy: "codex",
    generator: IMAGE_GENERATOR,
    mode: "built-in",
    file: relative(PROJECT_ROOT, destination),
    sha256: await sha256File(destination),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    embeddedFactualContent: false,
    promptSha256: sha256(brief.prompt),
    reviewedAgainstBrief: true,
    attachedAt: new Date().toISOString(),
  };
}

function toTwentyFourHour(timeLabel) {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(timeLabel);
  if (!match) throw new Error(`Invalid 12-hour time: ${timeLabel}`);
  let hour = Number(match[1]);
  if (match[3] === "AM" && hour === 12) hour = 0;
  if (match[3] === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}
