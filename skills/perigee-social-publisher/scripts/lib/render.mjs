import { mkdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import sharp from "sharp";
import { PROJECT_ROOT, perigeeRepo } from "./paths.mjs";
import { escapeXml, formatStationLocal, sha256File } from "./utils.mjs";

const W = 1080;
const H = 1350;

function dataUri(mime, buffer) {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function loadAssets() {
  const repo = perigeeRepo();
  const [display, sans, sansSemibold, logo] = await Promise.all([
    readFile(resolve(repo, "src/assets/og/newsreader-600italic.ttf")),
    readFile(resolve(repo, "src/assets/og/public-sans-400.ttf")),
    readFile(resolve(repo, "src/assets/og/public-sans-600.ttf")),
    readFile(resolve(repo, "public/logo-mark.png")),
  ]);
  return {
    fontCss: `
      @font-face { font-family: Newsreader; src: url(${dataUri("font/ttf", display)}); font-style: italic; font-weight: 600; }
      @font-face { font-family: PublicSans; src: url(${dataUri("font/ttf", sans)}); font-style: normal; font-weight: 400; }
      @font-face { font-family: PublicSans; src: url(${dataUri("font/ttf", sansSemibold)}); font-style: normal; font-weight: 600; }
    `,
    logoUri: dataUri("image/png", logo),
  };
}

function lines(values, { x, y, size, lineHeight, family = "PublicSans", weight = 400, fill, anchor = "start", italic = false }) {
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${italic ? ' font-style="italic"' : ""}>${values
    .map((value, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(value)}</tspan>`)
    .join("")}</text>`;
}

function grid(palette) {
  const geometry = [];
  for (let x = 0; x <= W; x += 90) {
    geometry.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${palette.ink}" stroke-opacity="0.055" />`);
  }
  for (let y = 0; y <= H; y += 90) {
    geometry.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${palette.ink}" stroke-opacity="0.055" />`);
  }
  return geometry.join("");
}

function frame({ assets, palette, eyebrow, slide, content, footer = "NOAA CO-OPS · STATION-LOCAL TIME · MLLW" }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <style>${assets.fontCss}</style>
    <rect width="${W}" height="${H}" fill="${palette.paper}" />
    ${grid(palette)}
    <image href="${assets.logoUri}" x="72" y="62" width="76" height="76" />
    <text x="172" y="99" font-family="PublicSans" font-size="28" font-weight="600" fill="${palette.ink}">PERIGEE</text>
    <text x="172" y="129" font-family="PublicSans" font-size="18" font-weight="400" letter-spacing="3" fill="${palette.inkSoft}">TIDES</text>
    <text x="1008" y="100" font-family="PublicSans" font-size="17" font-weight="600" letter-spacing="2" fill="${palette.magenta}" text-anchor="end">${escapeXml(eyebrow)}</text>
    ${content}
    <line x1="72" y1="1210" x2="1008" y2="1210" stroke="${palette.ink}" stroke-opacity="0.18" />
    <text x="72" y="1252" font-family="PublicSans" font-size="18" font-weight="600" letter-spacing="1.4" fill="${palette.inkSoft}">${escapeXml(footer)}</text>
    <text x="1008" y="1252" font-family="PublicSans" font-size="20" font-weight="600" fill="${palette.ink}" text-anchor="end">${slide}/5</text>
    <text x="72" y="1296" font-family="PublicSans" font-size="18" fill="${palette.inkSoft}">perigeetides.com</text>
  </svg>`;
}

function timeValue(value) {
  return new Date(`${value.replace(" ", "T")}:00Z`).valueOf();
}

function chartGeometry(predictions, palette, thresholdFt, compact = false) {
  const left = compact ? 70 : 110;
  const right = compact ? 1010 : 970;
  const top = compact ? 790 : 350;
  const bottom = compact ? 1100 : 1025;
  const times = predictions.map((prediction) => timeValue(prediction.t));
  const values = predictions.map((prediction) => prediction.v);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minValue = Math.min(...values) - 0.35;
  const maxValue = Math.max(...values) + 0.35;
  const x = (value) => left + ((value - minTime) / (maxTime - minTime || 1)) * (right - left);
  const y = (value) => bottom - ((value - minValue) / (maxValue - minValue || 1)) * (bottom - top);
  const path = predictions
    .map((prediction, index) => `${index === 0 ? "M" : "L"}${x(timeValue(prediction.t)).toFixed(1)},${y(prediction.v).toFixed(1)}`)
    .join(" ");
  const circles = predictions
    .map((prediction) => `<circle cx="${x(timeValue(prediction.t)).toFixed(1)}" cy="${y(prediction.v).toFixed(1)}" r="${compact ? 6 : 9}" fill="${prediction.type === "H" ? palette.magenta : palette.tide}" stroke="${palette.paper}" stroke-width="4" />`)
    .join("");
  let threshold = "";
  if (Number.isFinite(thresholdFt)) {
    const thresholdY = y(thresholdFt);
    threshold = `<line x1="${left}" y1="${thresholdY.toFixed(1)}" x2="${right}" y2="${thresholdY.toFixed(1)}" stroke="${palette.brass}" stroke-width="3" stroke-dasharray="12 10" />
      ${compact ? "" : `<text x="${right}" y="${(thresholdY - 15).toFixed(1)}" font-family="PublicSans" font-size="18" font-weight="600" fill="${palette.brass}" text-anchor="end">PERIGEE THRESHOLD · ${thresholdFt.toFixed(3)} FT</text>`}`;
  }
  const horizontal = [0.25, 0.5, 0.75]
    .map((fraction) => {
      const gridY = top + (bottom - top) * fraction;
      return `<line x1="${left}" y1="${gridY}" x2="${right}" y2="${gridY}" stroke="${palette.ink}" stroke-opacity="0.12" />`;
    })
    .join("");
  return {
    svg: `${horizontal}${threshold}<path d="${path}" fill="none" stroke="${palette.ink}" stroke-width="${compact ? 5 : 6}" stroke-linecap="round" stroke-linejoin="round" />${circles}`,
    left,
    right,
    top,
    bottom,
    minValue,
    maxValue,
  };
}

function slideOne(manifest, assets, palette) {
  const headline = manifest.creative.headline.includes("Golden Gate")
    ? ["Golden Gate", "crossed a king-tide", "threshold"]
    : wrapWords(manifest.creative.headline, 24);
  const chart = chartGeometry(manifest.data.predictions, palette, manifest.data.metrics.thresholdFt, true);
  const cluster = manifest.data.kingTideCluster;
  const content = `
    <rect x="72" y="218" width="390" height="50" rx="25" fill="${palette.shoal}" />
    <text x="267" y="251" font-family="PublicSans" font-size="18" font-weight="600" letter-spacing="1.6" fill="${palette.ink}" text-anchor="middle">${escapeXml((cluster?.label || "WEEK AHEAD").toUpperCase())} · ${escapeXml(manifest.station.stateName.toUpperCase())}</text>
    ${lines(headline, { x: 72, y: 374, size: 77, lineHeight: 84, family: "Newsreader", weight: 600, fill: palette.ink, italic: true })}
    <text x="76" y="690" font-family="PublicSans" font-size="25" fill="${palette.inkSoft}">NOAA station ${escapeXml(manifest.station.id)} · one local prediction window</text>
    ${chart.svg}
  `;
  return frame({ assets, palette, eyebrow: "KING-TIDE SIGNAL", slide: 1, content });
}

function slideTwo(manifest, assets, palette) {
  const peak = manifest.data.kingTideCluster
    ? {
        value: manifest.data.kingTideCluster.peakHeight,
        ...formatStationLocal(`${manifest.data.kingTideCluster.peakDateKey} ${toTwentyFourHour(manifest.data.kingTideCluster.peakTimeLabel)}`),
      }
    : manifest.data.metrics.highest;
  const content = `
    <text x="72" y="250" font-family="PublicSans" font-size="26" font-weight="600" letter-spacing="2" fill="${palette.magenta}">THE PREDICTED HIGH</text>
    <text x="72" y="535" font-family="Newsreader" font-size="270" font-weight="600" font-style="italic" fill="${palette.ink}">${peak.value.toFixed(2)}</text>
    <text x="790" y="526" font-family="PublicSans" font-size="60" font-weight="600" fill="${palette.inkSoft}">ft</text>
    <rect x="72" y="618" width="936" height="235" rx="30" fill="${palette.shoal}" />
    <text x="112" y="696" font-family="PublicSans" font-size="28" font-weight="600" fill="${palette.ink}">${escapeXml(peak.timeLabel)} · ${escapeXml(peak.dateLabel)}</text>
    <text x="112" y="752" font-family="PublicSans" font-size="25" fill="${palette.inkSoft}">Station-local time</text>
    <text x="112" y="816" font-family="PublicSans" font-size="25" fill="${palette.inkSoft}">Feet above local MLLW · astronomical prediction</text>
    <text x="72" y="950" font-family="PublicSans" font-size="28" font-weight="600" fill="${palette.ink}">${escapeXml(manifest.creative.stationName)}</text>
    <text x="72" y="999" font-family="PublicSans" font-size="23" fill="${palette.inkSoft}">NOAA CO-OPS station ${escapeXml(manifest.station.id)}</text>
  `;
  return frame({ assets, palette, eyebrow: "ONE STATION · LOCAL DATUM", slide: 2, content });
}

function slideThree(manifest, assets, palette) {
  const chart = chartGeometry(manifest.data.predictions, palette, manifest.data.metrics.thresholdFt, false);
  const first = formatStationLocal(manifest.data.predictions[0].t);
  const last = formatStationLocal(manifest.data.predictions.at(-1).t);
  const content = `
    <text x="72" y="235" font-family="Newsreader" font-size="64" font-weight="600" font-style="italic" fill="${palette.ink}">The actual seven-day curve</text>
    <text x="72" y="286" font-family="PublicSans" font-size="23" fill="${palette.inkSoft}">Matched point-for-point between Perigee and NOAA CO-OPS</text>
    ${chart.svg}
    <text x="${chart.left}" y="1085" font-family="PublicSans" font-size="19" font-weight="600" fill="${palette.inkSoft}">${escapeXml(first.dateLabel.replace(/, 2026$/, ""))}</text>
    <text x="${chart.right}" y="1085" font-family="PublicSans" font-size="19" font-weight="600" fill="${palette.inkSoft}" text-anchor="end">${escapeXml(last.dateLabel.replace(/, 2026$/, ""))}</text>
    <circle cx="72" cy="1140" r="8" fill="${palette.magenta}" /><text x="94" y="1148" font-family="PublicSans" font-size="18" fill="${palette.inkSoft}">predicted high</text>
    <circle cx="286" cy="1140" r="8" fill="${palette.tide}" /><text x="308" y="1148" font-family="PublicSans" font-size="18" fill="${palette.inkSoft}">predicted low</text>
  `;
  return frame({ assets, palette, eyebrow: "NOT A DECORATIVE CURVE", slide: 3, content });
}

function slideFour(manifest, assets, palette) {
  const highs = manifest.data.predictions
    .filter((prediction) => prediction.type === "H")
    .sort((left, right) => right.v - left.v)
    .slice(0, 3);
  const rows = highs
    .map((prediction, index) => {
      const local = formatStationLocal(prediction.t);
      const y = 760 + index * 105;
      const above = prediction.v >= manifest.data.metrics.thresholdFt;
      return `<text x="100" y="${y}" font-family="PublicSans" font-size="24" font-weight="600" fill="${palette.ink}">${escapeXml(local.dateLabel.replace(/, 2026$/, ""))} · ${escapeXml(local.timeLabel)}</text>
        <text x="944" y="${y}" font-family="PublicSans" font-size="30" font-weight="600" fill="${above ? palette.magenta : palette.ink}" text-anchor="end">${prediction.v.toFixed(3)} ft</text>
        <line x1="100" y1="${y + 30}" x2="944" y2="${y + 30}" stroke="${palette.ink}" stroke-opacity="0.12" />`;
    })
    .join("");
  const content = `
    <text x="72" y="245" font-family="PublicSans" font-size="26" font-weight="600" letter-spacing="2" fill="${palette.magenta}">WHY PERIGEE FLAGGED IT</text>
    <text x="72" y="490" font-family="Newsreader" font-size="190" font-weight="600" font-style="italic" fill="${palette.ink}">top 1%</text>
    <text x="76" y="565" font-family="PublicSans" font-size="28" fill="${palette.inkSoft}">of this station's predicted annual high tides</text>
    <rect x="72" y="620" width="936" height="72" rx="20" fill="${palette.shoal}" />
    <text x="105" y="666" font-family="PublicSans" font-size="25" font-weight="600" fill="${palette.ink}">2026 threshold</text>
    <text x="970" y="666" font-family="PublicSans" font-size="29" font-weight="600" fill="${palette.brass}" text-anchor="end">${manifest.data.metrics.thresholdFt.toFixed(3)} ft MLLW</text>
    ${rows}
  `;
  return frame({ assets, palette, eyebrow: "PERIGEE DEFINITION", slide: 4, content });
}

function slideFive(manifest, assets, palette) {
  const content = `
    <text x="72" y="260" font-family="Newsreader" font-size="72" font-weight="600" font-style="italic" fill="${palette.ink}">Prediction ≠ observation</text>
    <rect x="72" y="328" width="936" height="430" rx="32" fill="${palette.shoal}" />
    <circle cx="118" cy="402" r="11" fill="${palette.magenta}" />
    ${lines(["Astronomical prediction", "at one NOAA station"], { x: 154, y: 412, size: 28, lineHeight: 40, weight: 600, fill: palette.ink })}
    <circle cx="118" cy="540" r="11" fill="${palette.tide}" />
    ${lines(["Not an observed water level", "and not a flood forecast"], { x: 154, y: 550, size: 28, lineHeight: 40, weight: 600, fill: palette.ink })}
    <circle cx="118" cy="678" r="11" fill="${palette.brass}" />
    ${lines(["Wind, pressure, waves and rain", "can move observed water"], { x: 154, y: 688, size: 28, lineHeight: 40, weight: 600, fill: palette.ink })}
    <text x="72" y="866" font-family="PublicSans" font-size="25" font-weight="600" letter-spacing="1.5" fill="${palette.magenta}">EXPLORE THE FULL CALENDAR</text>
    ${lines(wrapWords(manifest.creative.ctaDisplay, 43), { x: 72, y: 930, size: 27, lineHeight: 38, weight: 600, fill: palette.ink })}
    ${lines(wrapWords(manifest.creative.disclaimer, 65), { x: 72, y: 1060, size: 20, lineHeight: 31, fill: palette.inkSoft })}
  `;
  return frame({ assets, palette, eyebrow: "SOURCE + LIMITS", slide: 5, content });
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

function toTwentyFourHour(timeLabel) {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(timeLabel);
  if (!match) throw new Error(`Invalid 12-hour time: ${timeLabel}`);
  let hour = Number(match[1]);
  if (match[3] === "AM" && hour === 12) hour = 0;
  if (match[3] === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export async function renderSlides(manifest, postDir, config) {
  const assets = await loadAssets();
  const palette = config.brand.palette;
  const slidesDir = resolve(postDir, "slides");
  await mkdir(slidesDir, { recursive: true });
  const svgs = [
    slideOne(manifest, assets, palette),
    slideTwo(manifest, assets, palette),
    slideThree(manifest, assets, palette),
    slideFour(manifest, assets, palette),
    slideFive(manifest, assets, palette),
  ];
  const names = ["01-cover.jpg", "02-peak.jpg", "03-curve.jpg", "04-threshold.jpg", "05-source.jpg"];
  const rendered = [];
  for (let index = 0; index < svgs.length; index += 1) {
    const path = resolve(slidesDir, names[index]);
    await sharp(Buffer.from(svgs[index]))
      .flatten({ background: palette.paper })
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
