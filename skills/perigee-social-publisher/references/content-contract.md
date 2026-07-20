# Perigee social content contract

## Source truth

- Fetch astronomical tide predictions from both the Perigee API and NOAA
  CO-OPS for the same station, date window, datum, units, interval, and station
  timezone. Require point-for-point agreement before publication.
- Preserve three-decimal source values in the manifest. Round display heights
  to two decimals and never reuse a local MLLW height for another station.
- Treat a station as a representative comparison point, not a beach, city,
  harbor, state maximum, or flood forecast.
- Give image generation only the point-for-point matched returned data. When a
  slide includes a tide curve, the prompt must enumerate every point and Codex
  must visually verify the generated curve against that series. Decorative
  curves must never be presented as the station trace.

## Required language

Prediction posts must include:

- “predicted” near the primary height or time;
- station name and NOAA station ID;
- station-local time;
- feet above local MLLW;
- NOAA CO-OPS attribution;
- “Planning aid — not for navigation or a substitute for official advisories,
  local procedures, or operator judgment.”

King-tide posts must say that Perigee uses the station's top 1% of predicted
annual high tides. Never imply that NOAA defines one universal king-tide
threshold. Explain that wind, pressure, waves, rainfall, and other effects can
move observed water above or below an astronomical prediction.

## Voice and claims

Lead with the useful fact, then evidence and the next action. Stay calm,
specific, candid, and concise. Do not manufacture urgency, certainty, safety,
scarcity, savings, testimonials, or engagement claims.

Prohibited claims include “safe,” “unsafe,” “all clear,” “guaranteed,”
“real-time,” “perfect conditions,” and “navigation-grade.”

## Local discovery and engagement

- Lead both platform captions with the locality and region represented by the selected NOAA
  station, then immediately identify the station-level prediction boundary.
- Include three natural local search phrases in the structured discovery plan.
- Use 5–10 focused hashtags: one Perigee brand tag, at least two locality tags,
  and a small number of relevant tide/coastal-planning tags. Do not use a long
  generic block or unrelated trending tags.
- Ask one useful action or question, such as saving the chart for planning or
  requesting the next station. Do not manufacture urgency or engagement claims.
- Suggest an existing Instagram place near the station. A verified numeric
  location ID may be sent with the publishing container; otherwise the live
  post requires a manual existing-place edit and verification.
- Keep Instagram's profile-oriented CTA as link-in-bio copy. Facebook must use
  a directly clickable Perigee CTA carrying `utm_source=facebook`; it must not
  say “link in bio.”

## Accessibility

- Use high contrast and do not rely on color alone.
- Provide one alt-text entry per carousel slide. Name the chart and its key
  numeric takeaway without copying the whole caption.
- Render 1080×1350 JPEG feed assets. Keep critical text inside 90-pixel side
  and 100-pixel top/bottom safe areas.
- Generate the entire slide as one image: background, type, data presentation,
  chart or information design, and visible copy. Do not add deterministic
  overlays or composite generated backgrounds with rendered PNG/SVG assets.
- Inspect every generated string and number verbatim. Regenerate a slide with
  clipped, warped, misspelled, omitted, invented, or inaccurate content.
