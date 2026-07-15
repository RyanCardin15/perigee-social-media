import { mkdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import sharp from "sharp";
import { PROJECT_ROOT, perigeeRepo } from "./paths.mjs";
import { escapeXml, formatStationLocal, sha256File } from "./utils.mjs";

const W = 1080;
const H = 1350;
const SAFE_X = 72;
const SAFE_RIGHT = W - SAFE_X;

function dataUri(mime, buffer) {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function loadAssets(manifest) {
  const repo = perigeeRepo();
  const artworkPath = resolve(PROJECT_ROOT, manifest.creative.artwork.file);
  const [display, sans, sansSemibold, logo, artwork, artworkMetadata] = await Promise.all([
    readFile(resolve(repo, "src/assets/og/newsreader-600italic.ttf")),
    readFile(resolve(repo, "src/assets/og/public-sans-400.ttf")),
    readFile(resolve(repo, "src/assets/og/public-sans-600.ttf")),
    readFile(resolve(repo, "public/logo-mark.png")),
    readFile(artworkPath),
    sharp(artworkPath).metadata(),
  ]);
  const mime = artworkMetadata.format === "jpeg" ? "image/jpeg" : `image/${artworkMetadata.format}`;
  return {
    fontCss: `
      @font-face { font-family: Newsreader; src: url(${dataUri("font/ttf", display)}); font-style: italic; font-weight: 600; }
      @font-face { font-family: PublicSans; src: url(${dataUri("font/ttf", sans)}); font-style: normal; font-weight: 400; }
      @font-face { font-family: PublicSans; src: url(${dataUri("font/ttf", sansSemibold)}); font-style: normal; font-weight: 600; }
    `,
    logoUri: dataUri("image/png", logo),
    artworkUri: dataUri(mime, artwork),
  };
}

function lines(values, { x, y, size, lineHeight, family = "PublicSans", weight = 400, fill, anchor = "start", italic = false }) {
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${italic ? ' font-style="italic"' : ""}>${values
    .map((value, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(value)}</tspan>`)
    .join("")}</text>`;
}

function brandHeader({ assets, palette, inverse = false, label }) {
  const text = inverse ? palette.paper : palette.ink;
  const soft = inverse ? palette.paper : palette.inkSoft;
  return `
    <rect x="${SAFE_X}" y="56" width="64" height="64" rx="18" fill="${palette.paper}" />
    <image href="${assets.logoUri}" x="${SAFE_X + 4}" y="60" width="56" height="56" />
    <text x="158" y="86" font-family="PublicSans" font-size="23" font-weight="600" letter-spacing="1.4" fill="${text}">PERIGEE</text>
    <text x="158" y="112" font-family="PublicSans" font-size="14" letter-spacing="4" fill="${soft}">TIDES</text>
    <text x="${SAFE_RIGHT}" y="94" font-family="PublicSans" font-size="15" font-weight="600" letter-spacing="2.2" fill="${inverse ? palette.paper : palette.magenta}" text-anchor="end">${escapeXml(label)}</text>`;
}

function footer({ palette, slide, inverse = false }) {
  const text = inverse ? palette.paper : palette.inkSoft;
  const rule = inverse ? palette.paper : palette.ink;
  return `
    <line x1="${SAFE_X}" y1="1214" x2="${SAFE_RIGHT}" y2="1214" stroke="${rule}" stroke-opacity="0.24" />
    <text x="${SAFE_X}" y="1254" font-family="PublicSans" font-size="16" font-weight="600" letter-spacing="1.4" fill="${text}">NOAA CO-OPS · STATION-LOCAL · MLLW</text>
    <text x="${SAFE_RIGHT}" y="1254" font-family="PublicSans" font-size="19" font-weight="600" fill="${inverse ? palette.paper : palette.ink}" text-anchor="end">${slide}/5</text>
    <text x="${SAFE_X}" y="1296" font-family="PublicSans" font-size="17" fill="${text}">perigeetides.com</text>`;
}

function darkBackground(palette) {
  return `
    <rect width="${W}" height="${H}" fill="${palette.inkDark}" />
    <circle cx="1010" cy="300" r="350" fill="none" stroke="${palette.tide}" stroke-opacity="0.12" stroke-width="2" />
    <circle cx="1010" cy="300" r="270" fill="none" stroke="${palette.tide}" stroke-opacity="0.09" stroke-width="2" />
    <circle cx="1010" cy="300" r="190" fill="none" stroke="${palette.magenta}" stroke-opacity="0.10" stroke-width="2" />`;
}

function document({ assets, palette, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <style>${assets.fontCss}</style>
    ${body}
  </svg>`;
}

function coverSlide(manifest, assets, palette) {
  const cluster = manifest.data.kingTideCluster;
  const peak = displayPeak(manifest);
  const headline = manifest.creative.headline.includes("Golden Gate")
    ? ["Golden Gate", "crossed a king-tide", "threshold"]
    : wrapWords(manifest.creative.headline, 24);
  const period = `${(cluster?.label || "WEEK AHEAD").toUpperCase()} · ${manifest.station.stateName.toUpperCase()}`;
  return document({ assets, palette, body: `
    <defs>
      <linearGradient id="coverShade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${palette.inkDark}" stop-opacity="0.96" />
        <stop offset="0.50" stop-color="${palette.inkDark}" stop-opacity="0.72" />
        <stop offset="1" stop-color="${palette.inkDark}" stop-opacity="0.22" />
      </linearGradient>
      <linearGradient id="coverFloor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.50" stop-color="${palette.inkDark}" stop-opacity="0" />
        <stop offset="1" stop-color="${palette.inkDark}" stop-opacity="0.92" />
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="${palette.inkDark}" />
    <image href="${assets.artworkUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" />
    <rect width="${W}" height="${H}" fill="url(#coverShade)" />
    <rect width="${W}" height="${H}" fill="url(#coverFloor)" />
    ${brandHeader({ assets, palette, inverse: true, label: manifest.creative.contentType === "king-tide-prediction" ? "KING-TIDE SIGNAL" : "WEEK AHEAD" })}
    <rect x="${SAFE_X}" y="218" width="430" height="48" rx="24" fill="${palette.paper}" fill-opacity="0.94" />
    <circle cx="101" cy="242" r="7" fill="${palette.magenta}" />
    <text x="122" y="249" font-family="PublicSans" font-size="17" font-weight="600" letter-spacing="1.4" fill="${palette.ink}">${escapeXml(period)}</text>
    ${lines(headline, { x: SAFE_X, y: 382, size: 74, lineHeight: 80, family: "Newsreader", weight: 600, fill: palette.paper, italic: true })}
    <text x="${SAFE_X}" y="655" font-family="PublicSans" font-size="22" fill="${palette.paper}" fill-opacity="0.82">One verified NOAA station · astronomical prediction</text>
    <rect x="${SAFE_X}" y="770" width="936" height="250" rx="38" fill="${palette.inkDark}" fill-opacity="0.82" stroke="${palette.paper}" stroke-opacity="0.22" />
    <text x="108" y="832" font-family="PublicSans" font-size="18" font-weight="600" letter-spacing="2" fill="${palette.magentaLight}">PREDICTED HIGH</text>
    <text x="104" y="958" font-family="Newsreader" font-size="146" font-weight="600" font-style="italic" fill="${palette.paper}">${peak.value.toFixed(2)}</text>
    <text x="422" y="946" font-family="PublicSans" font-size="38" font-weight="600" fill="${palette.paper}" fill-opacity="0.72">ft MLLW</text>
    <line x1="596" y1="818" x2="596" y2="972" stroke="${palette.paper}" stroke-opacity="0.22" />
    <text x="638" y="866" font-family="PublicSans" font-size="27" font-weight="600" fill="${palette.paper}">${escapeXml(peak.timeLabel)}</text>
    <text x="638" y="912" font-family="PublicSans" font-size="23" fill="${palette.paper}" fill-opacity="0.78">${escapeXml(peak.dateLabel)}</text>
    <text x="638" y="958" font-family="PublicSans" font-size="19" fill="${palette.paper}" fill-opacity="0.66">station-local time</text>
    <text x="${SAFE_X}" y="1110" font-family="PublicSans" font-size="17" font-weight="600" letter-spacing="2" fill="${palette.paper}">SWIPE FOR THE VERIFIED CURVE →</text>
    ${footer({ palette, slide: 1, inverse: true })}` });
}

function signalSlide(manifest, assets, palette) {
  const peak = displayPeak(manifest);
  return document({ assets, palette, body: `
    ${darkBackground(palette)}
    ${brandHeader({ assets, palette, inverse: true, label: "THE SIGNAL" })}
    <rect x="${SAFE_X}" y="184" width="936" height="950" rx="46" fill="${palette.paper}" />
    <rect x="104" y="224" width="214" height="42" rx="21" fill="${palette.magentaWash}" />
    <text x="211" y="251" font-family="PublicSans" font-size="16" font-weight="600" letter-spacing="1.6" fill="${palette.magenta}" text-anchor="middle">PREDICTED HIGH</text>
    <text x="104" y="520" font-family="Newsreader" font-size="260" font-weight="600" font-style="italic" fill="${palette.ink}">${peak.value.toFixed(2)}</text>
    <text x="718" y="500" font-family="PublicSans" font-size="50" font-weight="600" fill="${palette.inkSoft}">ft</text>
    <text x="104" y="580" font-family="PublicSans" font-size="22" fill="${palette.inkSoft}">above local MLLW · astronomical prediction</text>
    <line x1="104" y1="632" x2="976" y2="632" stroke="${palette.ink}" stroke-opacity="0.16" />
    <text x="104" y="700" font-family="PublicSans" font-size="19" font-weight="600" letter-spacing="1.6" fill="${palette.magenta}">WHEN</text>
    <text x="104" y="758" font-family="PublicSans" font-size="34" font-weight="600" fill="${palette.ink}">${escapeXml(peak.timeLabel)} · ${escapeXml(peak.dateLabel)}</text>
    <text x="104" y="803" font-family="PublicSans" font-size="21" fill="${palette.inkSoft}">Station-local time</text>
    <text x="104" y="894" font-family="PublicSans" font-size="19" font-weight="600" letter-spacing="1.6" fill="${palette.tide}">WHERE THE DATA APPLIES</text>
    ${lines(wrapWords(manifest.creative.stationName, 39), { x: 104, y: 950, size: 33, lineHeight: 42, weight: 600, fill: palette.ink })}
    <text x="104" y="1058" font-family="PublicSans" font-size="21" fill="${palette.inkSoft}">NOAA CO-OPS station ${escapeXml(manifest.station.id)}</text>
    ${footer({ palette, slide: 2, inverse: true })}` });
}

function chartSlide(manifest, assets, palette) {
  const kingTide = manifest.creative.contentType === "king-tide-prediction";
  const chart = chartGeometry(manifest.data.predictions, palette, kingTide ? manifest.data.metrics.thresholdFt : undefined);
  const first = formatStationLocal(manifest.data.predictions[0].t);
  const last = formatStationLocal(manifest.data.predictions.at(-1).t);
  return document({ assets, palette, body: `
    ${darkBackground(palette)}
    ${brandHeader({ assets, palette, inverse: true, label: "THE CURVE" })}
    <rect x="${SAFE_X}" y="184" width="936" height="950" rx="46" fill="${palette.paper}" />
    <text x="104" y="268" font-family="Newsreader" font-size="58" font-weight="600" font-style="italic" fill="${palette.ink}">Seven days. Every turn.</text>
    <text x="104" y="310" font-family="PublicSans" font-size="19" fill="${palette.inkSoft}">Matched point-for-point between Perigee and NOAA CO-OPS</text>
    ${chart.svg}
    <text x="${chart.left}" y="964" font-family="PublicSans" font-size="18" font-weight="600" fill="${palette.inkSoft}">${escapeXml(first.dateLabel.replace(/, \d{4}$/, ""))}</text>
    <text x="${chart.right}" y="964" font-family="PublicSans" font-size="18" font-weight="600" fill="${palette.inkSoft}" text-anchor="end">${escapeXml(last.dateLabel.replace(/, \d{4}$/, ""))}</text>
    <circle cx="106" cy="1032" r="8" fill="${palette.magenta}" /><text x="128" y="1039" font-family="PublicSans" font-size="18" fill="${palette.inkSoft}">predicted high</text>
    <circle cx="320" cy="1032" r="8" fill="${palette.tide}" /><text x="342" y="1039" font-family="PublicSans" font-size="18" fill="${palette.inkSoft}">predicted low</text>
    ${kingTide ? `<line x1="600" y1="1032" x2="650" y2="1032" stroke="${palette.brass}" stroke-width="3" stroke-dasharray="9 8" /><text x="668" y="1039" font-family="PublicSans" font-size="18" fill="${palette.inkSoft}">Perigee threshold</text>` : ""}
    ${footer({ palette, slide: 3, inverse: true })}` });
}

function thresholdSlide(manifest, assets, palette) {
  if (manifest.creative.contentType !== "king-tide-prediction") {
    const { highest, lowest, rangeFt } = manifest.data.metrics;
    return document({ assets, palette, body: `
      ${darkBackground(palette)}
      ${brandHeader({ assets, palette, inverse: true, label: "THE WEEKLY RANGE" })}
      <text x="${SAFE_X}" y="258" font-family="PublicSans" font-size="20" font-weight="600" letter-spacing="2" fill="${palette.magentaLight}">ONE STATION · SEVEN DAYS</text>
      <text x="${SAFE_X}" y="492" font-family="PublicSans" font-size="178" font-weight="600" fill="${palette.paper}">${rangeFt.toFixed(2)}</text>
      <text x="710" y="472" font-family="PublicSans" font-size="44" font-weight="600" fill="${palette.paper}" fill-opacity="0.72">ft range</text>
      <rect x="${SAFE_X}" y="620" width="936" height="500" rx="42" fill="${palette.paper}" />
      <text x="112" y="700" font-family="PublicSans" font-size="18" font-weight="600" letter-spacing="1.5" fill="${palette.magenta}">HIGHEST PREDICTION</text>
      <text x="944" y="704" font-family="PublicSans" font-size="34" font-weight="600" fill="${palette.ink}" text-anchor="end">${highest.v.toFixed(2)} ft</text>
      <text x="112" y="758" font-family="PublicSans" font-size="22" fill="${palette.inkSoft}">${escapeXml(highest.timeLabel)} · ${escapeXml(highest.dateLabel)}</text>
      <line x1="112" y1="818" x2="944" y2="818" stroke="${palette.ink}" stroke-opacity="0.12" />
      <text x="112" y="890" font-family="PublicSans" font-size="18" font-weight="600" letter-spacing="1.5" fill="${palette.tide}">LOWEST PREDICTION</text>
      <text x="944" y="894" font-family="PublicSans" font-size="34" font-weight="600" fill="${palette.ink}" text-anchor="end">${lowest.v.toFixed(2)} ft</text>
      <text x="112" y="948" font-family="PublicSans" font-size="22" fill="${palette.inkSoft}">${escapeXml(lowest.timeLabel)} · ${escapeXml(lowest.dateLabel)}</text>
      <text x="112" y="1040" font-family="PublicSans" font-size="20" fill="${palette.inkSoft}">Feet above local MLLW · station-local time</text>
      ${footer({ palette, slide: 4, inverse: true })}` });
  }
  const highs = manifest.data.predictions
    .filter((prediction) => prediction.type === "H")
    .sort((left, right) => right.v - left.v)
    .slice(0, 3);
  const rows = highs.map((prediction, index) => {
    const local = formatStationLocal(prediction.t);
    const y = 804 + index * 96;
    const above = prediction.v >= manifest.data.metrics.thresholdFt;
    return `
      <text x="112" y="${y}" font-family="PublicSans" font-size="22" font-weight="600" fill="${palette.ink}">${escapeXml(local.dateLabel.replace(/, \d{4}$/, ""))} · ${escapeXml(local.timeLabel)}</text>
      <text x="944" y="${y}" font-family="PublicSans" font-size="27" font-weight="600" fill="${above ? palette.magenta : palette.ink}" text-anchor="end">${prediction.v.toFixed(3)} ft</text>
      <line x1="112" y1="${y + 30}" x2="944" y2="${y + 30}" stroke="${palette.ink}" stroke-opacity="0.12" />`;
  }).join("");
  return document({ assets, palette, body: `
    ${darkBackground(palette)}
    ${brandHeader({ assets, palette, inverse: true, label: "WHY IT MATTERS" })}
    <text x="${SAFE_X}" y="254" font-family="PublicSans" font-size="20" font-weight="600" letter-spacing="2" fill="${palette.magentaLight}">PERIGEE'S STATION-SPECIFIC DEFINITION</text>
    <text x="${SAFE_X}" y="490" font-family="PublicSans" font-size="158" font-weight="600" fill="${palette.paper}">top one</text>
    <text x="${SAFE_X}" y="552" font-family="PublicSans" font-size="24" font-weight="600" letter-spacing="1.2" fill="${palette.paper}" fill-opacity="0.78">PERCENT OF THIS STATION'S PREDICTED ANNUAL HIGHS</text>
    <rect x="${SAFE_X}" y="620" width="936" height="500" rx="42" fill="${palette.paper}" />
    <text x="112" y="692" font-family="PublicSans" font-size="18" font-weight="600" letter-spacing="1.5" fill="${palette.inkSoft}">2026 THRESHOLD</text>
    <text x="944" y="700" font-family="PublicSans" font-size="31" font-weight="600" fill="${palette.brass}" text-anchor="end">${manifest.data.metrics.thresholdFt.toFixed(3)} ft MLLW</text>
    ${rows}
    ${footer({ palette, slide: 4, inverse: true })}` });
}

function sourceSlide(manifest, assets, palette) {
  const actionLabel = manifest.creative.contentType === "king-tide-prediction"
    ? "EXPLORE THE FULL CALENDAR"
    : "OPEN THE FULL STATION CHART";
  return document({ assets, palette, body: `
    ${darkBackground(palette)}
    ${brandHeader({ assets, palette, inverse: true, label: "SOURCE + LIMITS" })}
    <text x="${SAFE_X}" y="270" font-family="Newsreader" font-size="69" font-weight="600" font-style="italic" fill="${palette.paper}">Prediction ≠ observation</text>
    <rect x="${SAFE_X}" y="326" width="936" height="496" rx="42" fill="${palette.paper}" />
    <circle cx="118" cy="414" r="11" fill="${palette.magenta}" />
    ${lines(["Astronomical prediction", "at one NOAA station"], { x: 154, y: 423, size: 27, lineHeight: 38, weight: 600, fill: palette.ink })}
    <circle cx="118" cy="562" r="11" fill="${palette.tide}" />
    ${lines(["Not an observed water level", "and not a flood forecast"], { x: 154, y: 571, size: 27, lineHeight: 38, weight: 600, fill: palette.ink })}
    <circle cx="118" cy="710" r="11" fill="${palette.brass}" />
    ${lines(["Wind, pressure, waves and rain", "can move observed water"], { x: 154, y: 719, size: 27, lineHeight: 38, weight: 600, fill: palette.ink })}
    <text x="${SAFE_X}" y="904" font-family="PublicSans" font-size="18" font-weight="600" letter-spacing="2" fill="${palette.magentaLight}">${actionLabel}</text>
    ${lines(wrapTechnical(manifest.creative.ctaDisplay, 48), { x: SAFE_X, y: 956, size: 25, lineHeight: 34, weight: 600, fill: palette.paper })}
    ${lines(wrapWords(manifest.creative.disclaimer, 68), { x: SAFE_X, y: 1060, size: 18, lineHeight: 28, fill: palette.paper })}
    ${footer({ palette, slide: 5, inverse: true })}` });
}

function chartGeometry(predictions, palette, thresholdFt) {
  const left = 112;
  const right = 944;
  const top = 390;
  const bottom = 900;
  const times = predictions.map((prediction) => timeValue(prediction.t));
  const values = predictions.map((prediction) => prediction.v);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...values) - 0.35;
  const maxValue = Math.max(...values) + 0.35;
  const x = (value) => left + ((value - minTime) / (maxTime - minTime || 1)) * (right - left);
  const y = (value) => bottom - ((value - minValue) / (maxValue - minValue || 1)) * (bottom - top);
  const points = predictions.map((prediction) => [x(timeValue(prediction.t)), y(prediction.v)]);
  const path = points.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${path} L${right},${bottom} L${left},${bottom} Z`;
  const circles = predictions.map((prediction, index) => {
    const [cx, cy] = points[index];
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${prediction.type === "H" ? palette.magenta : palette.tide}" stroke="${palette.paper}" stroke-width="4" />`;
  }).join("");
  const horizontal = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const gridY = top + (bottom - top) * fraction;
    return `<line x1="${left}" y1="${gridY}" x2="${right}" y2="${gridY}" stroke="${palette.ink}" stroke-opacity="0.10" />`;
  }).join("");
  const thresholdY = Number.isFinite(thresholdFt) ? y(thresholdFt) : null;
  const threshold = Number.isFinite(thresholdFt) ? `
    <line x1="${left}" y1="${thresholdY.toFixed(1)}" x2="${right}" y2="${thresholdY.toFixed(1)}" stroke="${palette.brass}" stroke-width="3" stroke-dasharray="10 9" />
    <rect x="674" y="${(thresholdY - 38).toFixed(1)}" width="270" height="31" rx="15" fill="${palette.paper}" />
    <text x="930" y="${(thresholdY - 16).toFixed(1)}" font-family="PublicSans" font-size="14" font-weight="600" fill="${palette.brass}" text-anchor="end">THRESHOLD · ${thresholdFt.toFixed(3)} FT</text>` : "";
  return {
    svg: `${horizontal}<path d="${area}" fill="${palette.tide}" fill-opacity="0.09" />${threshold}<path d="${path}" fill="none" stroke="${palette.ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />${circles}`,
    left,
    right,
  };
}

function displayPeak(manifest) {
  const cluster = manifest.data.kingTideCluster;
  if (cluster) {
    return {
      value: cluster.peakHeight,
      ...formatStationLocal(`${cluster.peakDateKey} ${toTwentyFourHour(cluster.peakTimeLabel)}`),
    };
  }
  return { value: manifest.data.metrics.highest.v, ...manifest.data.metrics.highest };
}

function wrapWords(value, maxCharacters) {
  const words = String(value).split(/\s+/);
  const result = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharacters && current) {
      result.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(current);
  return result;
}

function wrapTechnical(value, maxCharacters) {
  const result = [];
  let remaining = String(value);
  while (remaining.length > maxCharacters) {
    const slash = remaining.lastIndexOf("/", maxCharacters);
    const dash = remaining.lastIndexOf("-", maxCharacters);
    const boundary = Math.max(slash, dash);
    const cut = boundary >= Math.floor(maxCharacters * 0.55) ? boundary + 1 : maxCharacters;
    result.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) result.push(remaining);
  return result;
}

function timeValue(value) {
  return new Date(`${value.replace(" ", "T")}:00Z`).valueOf();
}

function toTwentyFourHour(timeLabel) {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(timeLabel);
  if (!match) throw new Error(`Invalid 12-hour time: ${timeLabel}`);
  let hour = Number(match[1]);
  if (match[3] === "AM" && hour === 12) hour = 0;
  if (match[3] === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export async function renderSlides(manifest, postDir, config) {
  const assets = await loadAssets(manifest);
  const palette = config.brand.palette;
  const slidesDir = resolve(postDir, "slides");
  await mkdir(slidesDir, { recursive: true });
  const svgs = [
    coverSlide(manifest, assets, palette),
    signalSlide(manifest, assets, palette),
    chartSlide(manifest, assets, palette),
    thresholdSlide(manifest, assets, palette),
    sourceSlide(manifest, assets, palette),
  ];
  const names = ["01-cover.jpg", "02-peak.jpg", "03-curve.jpg", "04-threshold.jpg", "05-source.jpg"];
  const rendered = [];
  for (let index = 0; index < svgs.length; index += 1) {
    const path = resolve(slidesDir, names[index]);
    await sharp(Buffer.from(svgs[index]))
      .flatten({ background: palette.inkDark })
      .jpeg({ quality: config.publishing.jpegQuality, chromaSubsampling: "4:4:4" })
      .toFile(path);
    rendered.push({
      order: index + 1,
      file: relative(PROJECT_ROOT, path),
      altText: manifest.creative.altTexts[index],
      sha256: await sha256File(path),
    });
  }
  return rendered;
}
