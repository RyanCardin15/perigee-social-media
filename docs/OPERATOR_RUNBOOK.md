# Social post operator runbook

The simplest manual workflow is to open Codex in this repository and use one of
the prompts below. Codex must generate every complete slide itself; the Node
scripts cannot substitute a renderer, template, stock asset, shell/API image
generator, or background-compositing step.

## Create a validated draft

```text
Use $perigee-social-publisher. Create a validated weekly tide draft for
YYYY-MM-DD. Run authorization preflight, check the publication ledger, and run
social:prepare. Read the exact generation-brief.json. For each of its five slide
prompts, call Codex built-in image generation directly to create the entire
finished slide: background, typography, data, chart or information design, and
all visible copy. Inspect every result against its EXACT TEXT, DATA SERIES, and
reviewChecklist; regenerate any inaccurate or illegible slide. Attach the five
reviewed image outputs with social:attach --confirm-reviewed and require
status=validated. Show me all five final slides. Stop without staging,
committing, pushing, or publishing.
```

For a location-specific draft, name the place and station ID, for example:
“Create a validated weekly tide draft for Galveston, Texas using NOAA station
8771450.” The resulting caption and manifest must pass the discovery checks.

For a king-tide check, replace “weekly tide draft” with “event-watch post.” A
quiet event-watch result is success and should create nothing.

## Create and publish

```text
Use $perigee-social-publisher. Create and publish the verified weekly tide post
for YYYY-MM-DD. Follow Perigee Feed System v2: run authorization and ledger
preflight, prepare, then use Codex built-in image generation directly for each
of the five exact prompts in generation-brief.json. Each output must be the
complete final slide with its background, type, factual data presentation,
chart or information design, and visible copy. Inspect every character, number,
chart point, safe area, and prediction boundary; regenerate failures. Do not use
SVG, PNG overlays, templates, deterministic composition, stock art, a shell/API
image generator, or prior assets. Attach only the five reviewed image outputs
with --confirm-reviewed, validate, and visually inspect the final JPEGs. Only
if every gate passes, stage, commit and push only this post and its public
assets, verify public checksums, publish with the gated Meta command, verify the
live post and ledger, then commit and push the publication state.
```

## Run preparation yourself

From `/Users/ryancardin/Src/Perigee/Perigee Social Media`:

```bash
npm run token:status
npm run account:verify
npm run social:prepare -- --mode weekly --date YYYY-MM-DD
```

To select an exact station and complete a no-publish rehearsal:

```bash
npm run social:prepare -- --mode weekly --date YYYY-MM-DD --station 8771450
# Generate, inspect, attach, and validate the five brief-driven slides.
npm run stage -- --manifest content/posts/<post-id>/manifest.json
npm run dry-run -- --manifest content/posts/<post-id>/manifest.json
```

The dry-run report must show `externalWritesPerformed: false`, the approved
local hashtags and keywords, five ordered child payloads, and the location
delivery. If no verified `location_id` is configured, add the named existing
place in Instagram after a real publish and verify it on the live post before
calling the location step complete.

Preparation prints the manifest and `generation-brief.json` paths and stops at
`awaiting-generation`. Then tell Codex:

```text
Read <post-directory>/generation-brief.json. Generate all five complete slide
images yourself with Codex built-in image generation, one exact prompt per
call. Inspect each image against its exact text, data series, safe area, and
review checklist; regenerate failures. Run social:attach --confirm-reviewed with
the five reviewed image output paths and show me the final carousel. Stop after
status=validated.
```

To check for a noteworthy king-tide event instead:

```bash
npm run social:prepare -- --mode event-watch --date YYYY-MM-DD
```

## Status guide

- `quiet`: no qualifying event; create and publish nothing.
- `awaiting-generation`: data is frozen and Codex must generate five finished
  slide images.
- `validated`: generated slide provenance, facts, alt text, and hashes passed;
  safe to review.
- `staged`: public assets were copied but the post is not yet published.
- `published`: Meta response, live post, journal, and ledger all agree.
- `blocked`: stop and resolve the named gate; do not bypass or delete state.

Never use `--force` for a post that appears in `state/publishing-ledger.jsonl`
or `state/publishing/`. Never reuse a prior generated slide or the checked-in v1
reference carousel.
