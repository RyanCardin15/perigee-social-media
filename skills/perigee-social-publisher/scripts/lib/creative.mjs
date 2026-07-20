import { formatStationLocal, slugify, titleCase } from "./utils.mjs";

function stationDisplayName(row) {
  if (row.stationId === "9414290") return "San Francisco (Golden Gate)";
  return titleCase(row.stationName);
}

function campaignUrl(path, postId, config, platform = "instagram") {
  const url = new URL(path, config.brand.website);
  const facebook = platform === "facebook";
  url.searchParams.set("utm_source", facebook ? config.campaign.facebookSource || "facebook" : config.campaign.source);
  url.searchParams.set("utm_medium", config.campaign.medium);
  url.searchParams.set(
    "utm_campaign",
    `${facebook ? config.campaign.facebookPostCampaignPrefix || "fb_" : config.campaign.postCampaignPrefix}${postId}`,
  );
  return url.toString();
}

function disclaimer() {
  return "Planning aid — not for navigation or a substitute for official advisories, local procedures, or operator judgment.";
}

function hashtag(value) {
  return `#${String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "")}`;
}

function createDiscovery(row, config) {
  const locality = titleCase(String(row.stationName).split(",")[0].replace(/\([^)]*\)/g, "").trim());
  const region = row.stateName;
  const localHashtags = [
    hashtag(`${locality}${row.stateCode}`),
    hashtag(`${locality}Tides`),
    hashtag(`${region}Coast`),
  ];
  const hashtags = [...new Set([
    "#PerigeeTides",
    ...localHashtags,
    "#TideTimes",
    "#CoastalPlanning",
    "#NOAA",
  ])];
  const instagramLocationId = config.discovery?.locationIds?.[row.stationId] || null;
  return {
    market: {
      locality,
      region,
      label: `${locality}, ${region}`,
    },
    keywords: [
      `${locality} tide predictions`,
      `${locality} tide times`,
      `${region} coastal planning`,
    ],
    hashtags,
    localHashtags,
    engagementPrompt: `Save this chart for coastal planning around ${locality}. Which ${region} coast station should Perigee cover next?`,
    locationTag: {
      suggestedName: `${locality}, ${region}`,
      latitude: Number.isFinite(row.latitude) ? row.latitude : null,
      longitude: Number.isFinite(row.longitude) ? row.longitude : null,
      instagramLocationId,
      delivery: instagramLocationId ? "content-publishing-api" : "manual-existing-place",
      status: instagramLocationId ? "configured" : "manual-required-after-publish",
    },
  };
}

export function createCreative({ candidate, dateKey, metrics, config }) {
  const { row, cluster, contentType, temporalFrame } = candidate;
  const stationName = stationDisplayName(row);
  const discovery = createDiscovery(row, config);
  const postId =
    candidate.temporalFrame === "recap" && row.stationId === "9414290"
      ? `${dateKey}-golden-gate-king-tide`
      : `${dateKey}-${row.stateSlug}-${slugify(contentType)}`;
  const highest = metrics.highest;
  const threshold = row.kingTideThresholdFt;
  const hasStateCalendar = Boolean(cluster && row.stateCalendarPath);
  const destinationPath = hasStateCalendar ? row.stateCalendarPath : row.stationPath;
  const ctaUrl = campaignUrl(destinationPath, postId, config);
  const facebookCtaUrl = campaignUrl(destinationPath, postId, config, "facebook");

  if (contentType === "king-tide-prediction") {
    const timing = formatStationLocal(`${cluster.peakDateKey} ${toTwentyFourHour(cluster.peakTimeLabel)}`);
    const recap = temporalFrame === "recap";
    const lead = recap
      ? `${shortStationName(stationName)} crossed Perigee's king-tide threshold this week.`
      : `${shortStationName(stationName)} is predicted to cross Perigee's king-tide threshold.`;
    const verb = recap ? "reached" : "is predicted to reach";
    const action = hasStateCalendar
      ? `Explore the ${row.stateName} 2026 calendar at the link in bio.`
      : `Open the full ${stationName} station chart at the link in bio.`;
    const facebookAction = hasStateCalendar
      ? `Explore the ${row.stateName} 2026 calendar: ${facebookCtaUrl}`
      : `Open the full ${stationName} station chart: ${facebookCtaUrl}`;
    const kingTideHashtags = [...new Set([...discovery.hashtags.slice(0, 4), "#KingTides", ...discovery.hashtags.slice(4)])];
    const caption = `${discovery.market.label} king-tide prediction. ${lead} 🌊\n\nAt NOAA station ${row.stationId}, the astronomical prediction ${verb} ${cluster.peakHeight.toFixed(3)} ft above local MLLW at ${cluster.peakTimeLabel} on ${timing.dateLabel} (station-local time). Perigee defines a king-tide window as the station's top 1% of predicted annual high tides; this station's 2026 threshold is ${threshold.toFixed(3)} ft.\n\nThis is a prediction at one NOAA station—not an observed water level or a flood forecast. Wind, pressure, waves, and rainfall can move observed water above or below the astronomical prediction.\n\n${action}\n\n${discovery.engagementPrompt}\n\nNOAA CO-OPS • ${disclaimer()}\n\n${kingTideHashtags.join(" ")}`;
    const facebookCaption = `${discovery.market.label} king-tide prediction. ${lead} 🌊\n\nAt NOAA station ${row.stationId}, the astronomical prediction ${verb} ${cluster.peakHeight.toFixed(3)} ft above local MLLW at ${cluster.peakTimeLabel} on ${timing.dateLabel} (station-local time). Perigee defines a king-tide window as the station's top 1% of predicted annual high tides; this station's 2026 threshold is ${threshold.toFixed(3)} ft.\n\nThis is a prediction at one NOAA station—not an observed water level or a flood forecast. Wind, pressure, waves, and rainfall can move observed water above or below the astronomical prediction.\n\n${facebookAction}\n\n${discovery.engagementPrompt}\n\nNOAA CO-OPS • ${disclaimer()}\n\n${kingTideHashtags.join(" ")}`;
    return {
      postId,
      contentType,
      temporalFrame,
      headline: recap ? `${shortStationName(stationName)} crossed a king-tide threshold` : `${row.stateName} king-tide window ahead`,
      eyebrow: "PERIGEE TIDES · KING-TIDE SIGNAL",
      stationName,
      caption,
      captions: { instagram: caption, facebook: facebookCaption },
      discovery: { ...discovery, hashtags: kingTideHashtags },
      ctaUrl,
      ctaUrls: { instagram: ctaUrl, facebook: facebookCtaUrl },
      ctaDisplay: `${config.brand.website.replace("https://", "")}${destinationPath}`,
      ctaLabel: hasStateCalendar ? "EXPLORE THE FULL CALENDAR" : "OPEN THE FULL STATION CHART",
      disclaimer: disclaimer(),
      altTexts: [
        `Perigee Tides title card: ${shortStationName(stationName)} ${recap ? "crossed" : "is predicted to cross"} a king-tide threshold during ${cluster.label}, 2026.`,
        `Data card for NOAA station ${row.stationId}: predicted high ${cluster.peakHeight.toFixed(2)} feet above local MLLW at ${cluster.peakTimeLabel} on ${timing.dateLabel}, station-local time.`,
        `Seven-day high and low tide prediction chart for ${stationName}, based on matched NOAA and Perigee data. A line marks the ${threshold.toFixed(3)}-foot Perigee king-tide threshold.`,
        `Explanation of Perigee's station-specific top-one-percent king-tide definition, with the ${threshold.toFixed(3)}-foot threshold and nearby predicted highs.`,
        `Source and limitations card: NOAA CO-OPS astronomical prediction at one station, not an observation or flood forecast; weather can change observed water levels.`,
      ],
    };
  }

  const caption = `${discovery.market.label} tide predictions for the week ahead.\n\nThe highest astronomical tide in this seven-day window is predicted at ${highest.v.toFixed(2)} ft above local MLLW at ${highest.timeLabel} on ${highest.dateLabel}. The lowest is ${metrics.lowest.v.toFixed(2)} ft, a predicted range of ${metrics.rangeFt.toFixed(2)} ft at NOAA station ${row.stationId}.\n\nTimes are station-local. Predictions are not observations or a flood forecast.\n\nOpen the full station chart at the link in bio.\n\n${discovery.engagementPrompt}\n\nNOAA CO-OPS • ${disclaimer()}\n\n${discovery.hashtags.join(" ")}`;
  const facebookCaption = `${discovery.market.label} tide predictions for the week ahead.\n\nThe highest astronomical tide in this seven-day window is predicted at ${highest.v.toFixed(2)} ft above local MLLW at ${highest.timeLabel} on ${highest.dateLabel}. The lowest is ${metrics.lowest.v.toFixed(2)} ft, a predicted range of ${metrics.rangeFt.toFixed(2)} ft at NOAA station ${row.stationId}.\n\nTimes are station-local. Predictions are not observations or a flood forecast.\n\nOpen the full station chart: ${facebookCtaUrl}\n\n${discovery.engagementPrompt}\n\nNOAA CO-OPS • ${disclaimer()}\n\n${discovery.hashtags.join(" ")}`;
  return {
    postId,
    contentType,
    temporalFrame,
    headline: `${row.stateName}: your tide week ahead`,
    eyebrow: "PERIGEE TIDES · WEEK AHEAD",
    stationName,
    caption,
    captions: { instagram: caption, facebook: facebookCaption },
    discovery,
    ctaUrl,
    ctaUrls: { instagram: ctaUrl, facebook: facebookCtaUrl },
    ctaDisplay: `${config.brand.website.replace("https://", "")}${destinationPath}`,
    disclaimer: disclaimer(),
    altTexts: [
      `Perigee Tides week-ahead title card for ${stationName}, NOAA station ${row.stationId}.`,
      `Highest predicted tide card: ${highest.v.toFixed(2)} feet above local MLLW at ${highest.timeLabel} on ${highest.dateLabel}.`,
      `Seven-day high and low tide prediction chart for ${stationName}, based on matched NOAA and Perigee data.`,
      `Weekly range card showing the highest and lowest astronomical predictions at NOAA station ${row.stationId}.`,
      `Source and limitations card: NOAA CO-OPS astronomical predictions at one station, not observations or a flood forecast.`,
    ],
  };
}

function shortStationName(stationName) {
  return stationName.includes("Golden Gate") ? "Golden Gate" : stationName;
}

function toTwentyFourHour(timeLabel) {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(timeLabel);
  if (!match) throw new Error(`Invalid 12-hour time: ${timeLabel}`);
  let hour = Number(match[1]);
  if (match[3] === "AM" && hour === 12) hour = 0;
  if (match[3] === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}
