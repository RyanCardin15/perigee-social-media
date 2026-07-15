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
- `npm run social:compose -- --manifest <path> --artwork <path>` attaches a
  reviewed Codex-generated editorial image, renders the carousel, and validates
  it.
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
source precision in manifests, render display values deterministically, use
station-local time and local MLLW, and never treat a prediction as an
observation or flood forecast. Follow
`skills/perigee-social-publisher/SKILL.md` and its content contract.

Codex built-in image generation is the only approved source for editorial
artwork. Generate from the post's `creative-brief.json`. Image models must not
draw text, numbers, charts, axes, maps, station geography, warnings, or provider
marks; those remain deterministic renderer responsibilities.

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
