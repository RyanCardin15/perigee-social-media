import assert from "node:assert/strict";
import test from "node:test";
import { createCreative } from "../skills/perigee-social-publisher/scripts/lib/creative.mjs";
import { createVisualBrief, DESIGN_SYSTEM_VERSION, IMAGE_GENERATOR } from "../skills/perigee-social-publisher/scripts/lib/design-system.mjs";
import { selectCandidate } from "../skills/perigee-social-publisher/scripts/lib/data.mjs";
import { formatStationLocal, parseArgs } from "../skills/perigee-social-publisher/scripts/lib/utils.mjs";

const row = {
  stateCode: "CA",
  stateName: "California",
  stateSlug: "california",
  stationId: "9414290",
  stationName: "SAN FRANCISCO (Golden Gate)",
  stationPath: "/tides/california/san-francisco-golden-gate-9414290",
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
  campaign: { source: "instagram", medium: "organic_social", postCampaignPrefix: "ig_" },
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
  assert.equal(new URL(creative.ctaUrl).searchParams.get("utm_source"), "instagram");
});

test("visual brief requires Codex artwork and keeps facts out of the pixels", () => {
  const manifest = {
    id: "2026-07-15-golden-gate-king-tide",
    station: { id: row.stationId, displayName: "San Francisco (Golden Gate)" },
    data: {
      kingTideCluster: row.kingTideClusters[0],
      metrics: { highest: { v: 7.198, dateLabel: "July 13, 2026", timeLabel: "11:01 PM" } },
    },
    creative: { contentType: "king-tide-prediction" },
  };
  const brief = createVisualBrief(manifest, {
    brand: {
      palette: {
        inkDark: "#071d2a",
        tide: "#0099a8",
        paper: "#faf9f4",
        magenta: "#c41e6a",
      },
    },
    publishing: { width: 1080, height: 1350 },
  });
  assert.equal(brief.designSystemVersion, DESIGN_SYSTEM_VERSION);
  assert.equal(brief.requiredGenerator.generatedBy, "codex");
  assert.equal(brief.requiredGenerator.generator, IMAGE_GENERATOR);
  assert.equal(brief.asset.embeddedFactualContent, false);
  assert.match(brief.prompt, /no text, numbers, letters, logos/i);
  assert.match(brief.prompt, /non-documentary/i);
});
