import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { createCreative } from "../skills/perigee-social-publisher/scripts/lib/creative.mjs";
import { attachGeneratedSlides, createGenerationBrief, DESIGN_SYSTEM_VERSION, IMAGE_GENERATOR } from "../skills/perigee-social-publisher/scripts/lib/design-system.mjs";
import { selectCandidate } from "../skills/perigee-social-publisher/scripts/lib/data.mjs";
import { formatStationLocal, parseArgs } from "../skills/perigee-social-publisher/scripts/lib/utils.mjs";
import { containsSecret } from "../skills/perigee-social-publisher/scripts/lib/validation.mjs";

const row = {
  stateCode: "CA",
  stateName: "California",
  stateSlug: "california",
  stationId: "9414290",
  stationName: "SAN FRANCISCO (Golden Gate)",
  stationPath: "/tides/california/san-francisco-golden-gate-9414290",
  latitude: 37.8063,
  longitude: -122.4659,
  stateCalendarPath: "/king-tides/california/2026",
  kingTideThresholdFt: 7.077,
  kingTideClusters: [
    {
      startKey: "2026-07-12",
      endKey: "2026-07-13",
      label: "Jul 12–13",
      peakHeight: 7.198,
      peakDateKey: "2026-07-13",
      peakTimeLabel: "11:01 PM",
    },
  ],
};

const config = {
  brand: { website: "https://perigeetides.com" },
  campaign: {
    source: "instagram",
    medium: "organic_social",
    postCampaignPrefix: "ig_",
    facebookSource: "facebook",
    facebookPostCampaignPrefix: "fb_",
  },
  launchPost: {
    stationId: "9414290",
    windowStart: "2026-07-12",
    windowHours: 168,
    clusterStart: "2026-07-12",
    clusterEnd: "2026-07-13",
  },
};

test("argument parser accepts inline values and flags", () => {
  assert.deepEqual(parseArgs(["--mode=launch", "--date", "2026-07-15", "--force"]), {
    mode: "launch",
    date: "2026-07-15",
    force: true,
  });
});

test("secret detection does not confuse lowercase SHA-256 prefixes with Meta tokens", () => {
  assert.equal(containsSecret('{"sourceSha256":"eaab1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"}'), false);
  assert.equal(containsSecret('{"sourceSha256":"EAA1234567890abcdef1234567890abcdef"}'), true);
  assert.equal(containsSecret('{"access_token":"secretvalue1234567890"}'), true);
});

test("station-local formatter never applies the machine timezone", () => {
  assert.deepEqual(formatStationLocal("2026-07-13 23:01"), {
    dateKey: "2026-07-13",
    dateLabel: "July 13, 2026",
    timeLabel: "11:01 PM",
  });
});

test("launch selection is pinned to the verified almanac cluster", () => {
  const selected = selectCandidate({
    mode: "launch",
    dateKey: "2026-07-15",
    config,
    almanac: { rows: [row] },
  });
  assert.equal(selected.row.stationId, "9414290");
  assert.equal(selected.cluster.peakHeight, 7.198);
  assert.equal(selected.temporalFrame, "recap");
});

test("event watch returns a quiet result when no cluster overlaps", () => {
  const selected = selectCandidate({
    mode: "event-watch",
    dateKey: "2026-08-01",
    config,
    almanac: { rows: [row] },
  });
  assert.equal(selected, null);
});

test("weekly selection can target an exact NOAA station", () => {
  const galveston = {
    ...row,
    stateCode: "TX",
    stateName: "Texas",
    stateSlug: "texas",
    stationId: "8771450",
    stationName: "GALVESTON, Galveston Channel",
  };
  const selected = selectCandidate({
    mode: "weekly",
    dateKey: "2026-07-16",
    stationId: "8771450",
    config,
    almanac: { rows: [row, galveston] },
  });
  assert.equal(selected.row.stationId, "8771450");
});

test("king-tide creative preserves prediction and MLLW boundaries", () => {
  const creative = createCreative({
    candidate: {
      row,
      cluster: row.kingTideClusters[0],
      contentType: "king-tide-prediction",
      temporalFrame: "recap",
    },
    dateKey: "2026-07-15",
    metrics: {
      highest: { v: 7.198, t: "2026-07-13 23:01", dateLabel: "July 13, 2026", timeLabel: "11:01 PM" },
      lowest: { v: -1.207, t: "2026-07-12 04:27", dateLabel: "July 12, 2026", timeLabel: "4:27 AM" },
      rangeFt: 8.405,
      thresholdFt: 7.077,
      thresholdCrossings: [],
    },
    config,
  });
  assert.match(creative.caption, /astronomical prediction/i);
  assert.match(creative.caption, /local MLLW/);
  assert.match(creative.caption, /not an observed water level or a flood forecast/i);
  assert.match(creative.caption, /not for navigation/i);
  assert.doesNotMatch(creative.caption, /\b(safe|guaranteed|real-time)\b/i);
  assert.equal(creative.altTexts.length, 5);
  assert.ok(creative.discovery.hashtags.length >= 5);
  assert.ok(creative.discovery.localHashtags.every((value) => creative.caption.includes(value)));
  assert.match(creative.caption, /San Francisco, California/);
  assert.equal(creative.discovery.locationTag.delivery, "manual-existing-place");
  assert.equal(new URL(creative.ctaUrl).searchParams.get("utm_source"), "instagram");
  assert.equal(new URL(creative.ctaUrls.facebook).searchParams.get("utm_source"), "facebook");
  assert.equal(new URL(creative.ctaUrls.facebook).searchParams.get("utm_campaign"), "fb_2026-07-15-golden-gate-king-tide");
  assert.match(creative.captions.instagram, /link in bio/);
  assert.match(creative.captions.facebook, /https:\/\/perigeetides\.com\/king-tides\/california\/2026/);
  assert.doesNotMatch(creative.captions.facebook, /link in bio/);
});

test("king-tide creative uses the actual station and falls back when no state calendar exists", () => {
  const guamRow = {
    ...row,
    stateCode: "GU",
    stateName: "Guam",
    stateSlug: "guam",
    stationId: "1630000",
    stationName: "APRA HARBOR, GUAM",
    stationPath: "/stations/1630000",
    stateCalendarPath: null,
    kingTideThresholdFt: 2.762,
  };
  const creative = createCreative({
    candidate: {
      row: guamRow,
      cluster: { ...row.kingTideClusters[0], peakHeight: 2.851, peakDateKey: "2026-07-15", peakTimeLabel: "6:54 AM" },
      contentType: "king-tide-prediction",
      temporalFrame: "recap",
    },
    dateKey: "2026-07-16",
    metrics: {
      highest: { v: 2.851, t: "2026-07-15 06:54", dateLabel: "July 15, 2026", timeLabel: "6:54 AM" },
      lowest: { v: -0.64, t: "2026-07-14 13:33", dateLabel: "July 14, 2026", timeLabel: "1:33 PM" },
      rangeFt: 3.491,
      thresholdFt: 2.762,
      thresholdCrossings: [],
    },
    config,
  });
  assert.equal(creative.headline, "Apra Harbor, Guam crossed a king-tide threshold");
  assert.equal(creative.ctaDisplay, "perigeetides.com/stations/1630000");
  assert.equal(creative.ctaLabel, "OPEN THE FULL STATION CHART");
  assert.equal(new URL(creative.ctaUrl).pathname, "/stations/1630000");
  assert.match(creative.caption, /Open the full Apra Harbor, Guam station chart/);
  assert.doesNotMatch(JSON.stringify(creative), /Golden Gate|\/null|\.comnull/);
});

test("generation brief requires Codex to generate every complete factual slide", () => {
  const manifest = {
    id: "2026-07-15-golden-gate-king-tide",
    station: {
      id: row.stationId,
      displayName: "San Francisco (Golden Gate)",
      kingTideThresholdFt: 7.077,
    },
    data: {
      kingTideCluster: row.kingTideClusters[0],
      predictions: [
        { t: "2026-07-12 04:27", v: -1.207, type: "L" },
        { t: "2026-07-13 23:01", v: 7.198, type: "H" },
        { t: "2026-07-14 23:44", v: 7.101, type: "H" },
      ],
      metrics: {
        highest: { v: 7.198, dateLabel: "July 13, 2026", timeLabel: "11:01 PM" },
        lowest: { v: -1.207, dateLabel: "July 12, 2026", timeLabel: "4:27 AM" },
        rangeFt: 8.405,
        thresholdFt: 7.077,
      },
    },
    creative: {
      contentType: "king-tide-prediction",
      eyebrow: "PERIGEE TIDES · KING-TIDE SIGNAL",
      headline: "Golden Gate crossed a king-tide threshold",
      ctaDisplay: "perigeetides.com/king-tides/california/2026",
      disclaimer: "Planning aid — not for navigation or a substitute for official advisories, local procedures, or operator judgment.",
    },
  };
  const brief = createGenerationBrief(manifest, {
    brand: {
      palette: {
        inkDark: "#071d2a",
        tide: "#0099a8",
        paper: "#faf9f4",
        magenta: "#c41e6a",
        brass: "#a06a0a",
      },
    },
    publishing: { width: 1080, height: 1350 },
  });
  assert.equal(brief.designSystemVersion, DESIGN_SYSTEM_VERSION);
  assert.equal(brief.requiredGenerator.generatedBy, "codex");
  assert.equal(brief.requiredGenerator.generator, IMAGE_GENERATOR);
  assert.equal(brief.output.count, 5);
  assert.equal(brief.output.deterministicOverlaysAllowed, false);
  assert.deepEqual(brief.output.generatedContentIncludes, ["background", "typography", "data", "chart", "information-design", "all-visible-copy"]);
  assert.equal(brief.slides.length, 5);
  assert.match(brief.slides[0].prompt, /entire finished Perigee Tides slide/i);
  assert.match(brief.slides[0].prompt, /Predicted high · 7\.20 ft/);
  assert.match(brief.slides[2].prompt, /Perigee top-1% threshold · 7\.077 ft/);
  assert.match(brief.slides[2].prompt, /July 13, 2026 \| 11:01 PM \| high \| 7\.198 ft MLLW/);
  assert.match(brief.slides[4].prompt, /Prediction ≠ observation/);
});

test("attachment uses generated image outputs without overlays or compositing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "perigee-generated-slides-"));
  try {
    const slidePaths = [];
    for (let order = 1; order <= 5; order += 1) {
      const path = join(directory, `source-${order}.png`);
      await sharp({
        create: {
          width: 800,
          height: 1000,
          channels: 3,
          background: { r: order * 20, g: 80, b: 120 },
        },
      }).png().toFile(path);
      slidePaths.push(path);
    }
    const manifestPath = join(directory, "manifest.json");
    const manifest = {
      creative: { altTexts: Array.from({ length: 5 }, (_, index) => `Accessible description for complete generated slide number ${index + 1}.`) },
    };
    const brief = {
      promptVersion: "test-full-generation",
      slides: Array.from({ length: 5 }, (_, index) => ({ order: index + 1, role: `role-${index + 1}`, prompt: `prompt-${index + 1}` })),
    };
    const slides = await attachGeneratedSlides({
      manifest,
      manifestPath,
      slidePaths,
      brief,
      config: { publishing: { width: 1080, height: 1350, jpegQuality: 92 } },
    });

    assert.equal(slides.length, 5);
    for (const slide of slides) {
      const metadata = await sharp(resolve(process.cwd(), slide.file)).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.width, 1080);
      assert.equal(metadata.height, 1350);
      assert.equal(slide.generatedBy, "codex");
      assert.equal(slide.embeddedFactualContent, true);
      assert.equal(slide.normalization, "orientation-resize-jpeg-only; no overlays or compositing");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
