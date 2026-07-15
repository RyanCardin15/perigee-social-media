# Repository Guidelines

## Scope

This repository owns Perigee's generated social assets, validation manifests,
publishing skill, and Instagram delivery scripts. It consumes product data and
brand assets from the sibling `../Perigee` repository but must not edit that
repository as part of a publishing run.

## Commands

- `npm test` runs the deterministic unit suite.
- `npm run social:prepare -- --mode weekly --date YYYY-MM-DD` freezes matched
  data and writes the Codex image brief for a post.
- `npm run social:prepare -- --mode event-watch --date YYYY-MM-DD` publishes
  nothing when no qualifying event exists.
- `npm run social:attach -- --manifest <path> --slide-1 <path> ... --slide-5
  <path> --confirm-reviewed` attaches five reviewed, complete Codex-generated
  slide images, normalizes them to publishable JPEGs without overlays, and
  validates them.
- `npm run validate -- --manifest <path>` reruns all factual and asset gates.
- `npm run stage -- --manifest <path>` copies verified JPEGs into `public/`.
- `npm run account:verify` checks the configured Business identity and live
  publishing quota without exposing the token.
- `npm run token:install -- --confirm` reads a newly generated token only from
  piped stdin, writes it privately, and records its lifecycle metadata.
- `npm run token:status` checks private expiry metadata.
- `npm run token:refresh -- --confirm` rotates an eligible long-lived token.
- `npm run publish -- --manifest <path> --confirm` performs the external Meta
  API write after public hosting and credentials are configured.

## Data and content rules

Require point-for-point agreement between Perigee and NOAA CO-OPS. Preserve
source precision in manifests and generation briefs, use station-local time and
local MLLW, and never treat a prediction as an observation or flood forecast.
Follow
`skills/perigee-social-publisher/SKILL.md` and its content contract.

Codex built-in image generation is the only approved source for finished post
slides. Generate all five complete slides from the exact prompts in the post's
`generation-brief.json`; the model owns the background, typography, factual data
presentation, chart, information design, and every visible word. Do not use SVG,
HTML, canvas, templates, deterministic text/chart overlays, composited
backgrounds, stock art, or another image generator. Codex must visually inspect
each result against the exact text and data, regenerate any inaccurate slide,
and attach only the reviewed image outputs. Post-generation processing is
limited to orientation, 1080×1350 sizing, and JPEG encoding for Meta delivery.

## Security

Never commit `.env.local`, access tokens, app secrets, passwords, email codes,
or account recovery material. Do not print secrets during diagnostics. Generated
public manifests may contain only public source URLs, station data, captions,
alt text, and asset checksums.

Never delete a publication journal to force a retry. Rerun the same publisher
command so an ambiguous Meta response is reconciled without a duplicate post.

## Git hygiene

Commit one generated post and its public assets together. Do not stage
`node_modules/` or unrelated files. Verify the live post and publishing ledger
before describing a run as complete.
