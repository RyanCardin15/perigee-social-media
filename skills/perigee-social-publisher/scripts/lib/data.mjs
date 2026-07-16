import { resolve } from "node:path";
import { loadJson, perigeeRepo } from "./paths.mjs";
import {
  addDays,
  compactDate,
  fetchJson,
  formatStationLocal,
  sha256,
} from "./utils.mjs";

export async function loadAlmanac() {
  const path = resolve(perigeeRepo(), "src/data/us-king-tides-2026.json");
  const almanac = await loadJson(path);
  if (almanac.schemaVersion !== 1 || !Array.isArray(almanac.rows)) {
    throw new Error("Unsupported or malformed Perigee king-tide almanac.");
  }
  return { path, almanac };
}

function overlaps(cluster, startKey, endKey) {
  return cluster.startKey <= endKey && cluster.endKey >= startKey;
}

function simpleWeekIndex(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const first = new Date(`${dateKey.slice(0, 4)}-01-01T00:00:00Z`);
  return Math.floor((date - first) / 604800000);
}

export function selectCandidate({ mode, dateKey, config, almanac, stationId = null }) {
  const requestedRow = stationId
    ? almanac.rows.find((candidate) => candidate.stationId === String(stationId))
    : null;
  if (stationId && !requestedRow) {
    throw new Error(`Station ${stationId} is missing from the Perigee almanac.`);
  }
  if (mode === "launch") {
    const row = almanac.rows.find((candidate) => candidate.stationId === config.launchPost.stationId);
    if (!row) throw new Error("Launch station is missing from the Perigee almanac.");
    const cluster = row.kingTideClusters.find(
      (candidate) =>
        candidate.startKey === config.launchPost.clusterStart &&
        candidate.endKey === config.launchPost.clusterEnd,
    );
    if (!cluster) throw new Error("Launch king-tide cluster is missing from the Perigee almanac.");
    return {
      row,
      cluster,
      windowStart: config.launchPost.windowStart,
      windowHours: config.launchPost.windowHours,
      contentType: "king-tide-prediction",
      temporalFrame: "recap",
    };
  }

  if (mode === "event-watch") {
    const endKey = addDays(dateKey, 7);
    const candidates = (requestedRow ? [requestedRow] : almanac.rows).flatMap((row) =>
      row.kingTideClusters
        .filter((cluster) => overlaps(cluster, dateKey, endKey))
        .map((cluster) => ({
          row,
          cluster,
          score: cluster.peakHeight - row.kingTideThresholdFt,
        })),
    );
    candidates.sort((left, right) => right.score - left.score);
    if (candidates.length === 0) return null;
    const selected = candidates[0];
    return {
      row: selected.row,
      cluster: selected.cluster,
      windowStart: addDays(selected.cluster.startKey, -1),
      windowHours: 168,
      contentType: "king-tide-prediction",
      temporalFrame: selected.cluster.peakDateKey < dateKey ? "recap" : "upcoming",
    };
  }

  if (mode === "weekly") {
    const rows = [...almanac.rows].sort((left, right) => left.stateCode.localeCompare(right.stateCode));
    const row = requestedRow || rows[simpleWeekIndex(dateKey) % rows.length];
    return {
      row,
      cluster: row.kingTideClusters.find((candidate) => overlaps(candidate, dateKey, addDays(dateKey, 6))) || null,
      windowStart: dateKey,
      windowHours: 168,
      contentType: "weekly-tide",
      temporalFrame: "upcoming",
    };
  }

  throw new Error(`Unsupported preparation mode: ${mode}`);
}

function normalizePredictions(predictions) {
  if (!Array.isArray(predictions)) throw new Error("Prediction response is missing its predictions array.");
  return predictions.map((prediction) => ({
    t: String(prediction.t),
    v: Number(Number(prediction.v).toFixed(3)),
    type: prediction.type === "H" ? "H" : prediction.type === "L" ? "L" : String(prediction.type),
  }));
}

export async function fetchMatchedPredictions({ row, windowStart, windowHours, config }) {
  const source = config.sources;
  const noaaParams = new URLSearchParams({
    product: "predictions",
    application: source.noaaApplication,
    begin_date: compactDate(windowStart),
    range: String(windowHours),
    datum: source.datum,
    station: row.stationId,
    time_zone: source.timeZone,
    units: source.units,
    interval: "hilo",
    format: "json",
  });
  const perigeeParams = new URLSearchParams({
    interval: "hilo",
    begin_date: windowStart,
    hours: String(windowHours),
    datum: source.datum,
    units: source.units,
    time_zone: source.timeZone,
  });
  const noaaUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${noaaParams}`;
  const perigeeUrl = `${config.brand.website}/api/v1/stations/${row.stationId}/predictions?${perigeeParams}`;
  const [noaaResponse, perigeeResponse] = await Promise.all([
    fetchJson(noaaUrl),
    fetchJson(perigeeUrl),
  ]);
  if (noaaResponse.error) throw new Error("NOAA returned an error for the selected prediction request.");
  const noaa = normalizePredictions(noaaResponse.predictions);
  const perigee = normalizePredictions(perigeeResponse.predictions);
  const noaaDigest = sha256(JSON.stringify(noaa));
  const perigeeDigest = sha256(JSON.stringify(perigee));
  const matched = noaaDigest === perigeeDigest;
  if (!matched) {
    throw new Error(`Perigee/NOAA prediction mismatch for station ${row.stationId}.`);
  }
  return {
    predictions: noaa,
    sources: {
      fetchedAt: new Date().toISOString(),
      matched,
      noaa: { url: noaaUrl, sha256: noaaDigest },
      perigee: { url: perigeeUrl, sha256: perigeeDigest },
    },
  };
}

export function deriveMetrics(predictions, thresholdFt) {
  const highs = predictions.filter((prediction) => prediction.type === "H");
  const lows = predictions.filter((prediction) => prediction.type === "L");
  if (highs.length === 0 || lows.length === 0) {
    throw new Error("A weekly post requires both high and low tide predictions.");
  }
  const highest = highs.reduce((best, prediction) => (prediction.v > best.v ? prediction : best));
  const lowest = lows.reduce((best, prediction) => (prediction.v < best.v ? prediction : best));
  const thresholdCrossings = highs.filter((prediction) => prediction.v >= thresholdFt);
  return {
    highest: { ...highest, ...formatStationLocal(highest.t) },
    lowest: { ...lowest, ...formatStationLocal(lowest.t) },
    rangeFt: Number((highest.v - lowest.v).toFixed(3)),
    thresholdFt,
    thresholdCrossings,
  };
}
