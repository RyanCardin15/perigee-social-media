# Social post operator runbook

The simplest way to create a post is to open Codex in this repository and give
it one of the prompts below. Codex must perform the image-generation step; the
Node scripts intentionally cannot substitute an image model or stock asset.

## Create a validated draft

Use this when you want to review the carousel before anything is staged or
published:

```text
Use $perigee-social-publisher. Create a validated weekly tide draft for
YYYY-MM-DD. Run the authorization preflight, check the publication ledger,
prepare the post, read its exact creative-brief.json, generate the editorial
artwork yourself with Codex built-in image generation, inspect it against the
brief, compose and validate all five slides, and show me the result. Stop after
status=validated. Do not stage, commit, push, or publish.
```

For a king-tide check, replace “weekly tide draft” with “event-watch post.” A
quiet event-watch result is success and should create nothing.

## Create and publish

Use this only when you want Codex to carry the validated post through the live
publishing gates:

```text
Use $perigee-social-publisher. Create and publish the verified weekly tide post
for YYYY-MM-DD. Follow Perigee Feed System v1: run authorization and ledger
preflight, prepare, generate new artwork yourself with Codex built-in image
generation from the exact creative brief, inspect it, compose, validate, and
visually inspect all five slides. Only if every gate passes, stage, commit and
push only this post and its public assets, verify the hosted JPEG checksums,
publish with the gated Meta command, verify the live post and ledger, then
commit and push the publication state. Never reuse reference or prior artwork.
```

## Run the first step yourself

From `/Users/ryancardin/Src/Perigee/Perigee Social Media`:

```bash
npm run token:status
npm run account:verify
npm run social:prepare -- --mode weekly --date YYYY-MM-DD
```

Preparation prints the manifest and brief paths and stops at
`awaiting-artwork`. Then tell Codex:

```text
Read <post-directory>/creative-brief.json. Generate the artwork yourself with
Codex built-in image generation, inspect it against every reviewChecklist item,
run social:compose with the selected image, and show me all five slides. Stop
after status=validated; do not publish.
```

To check for a noteworthy king-tide event instead:

```bash
npm run social:prepare -- --mode event-watch --date YYYY-MM-DD
```

## Status guide

- `quiet`: no qualifying event; create and publish nothing.
- `awaiting-artwork`: data is frozen and Codex must generate the image.
- `validated`: artwork, facts, slides, alt text, and hashes passed; safe to
  review.
- `staged`: public assets were copied but the post is not yet published.
- `published`: Meta response, live post, journal, and ledger all agree.
- `blocked`: stop and resolve the named gate; do not bypass or delete state.

Never use `--force` for a post that appears in `state/publishing-ledger.jsonl`
or `state/publishing/`. Never reuse the checked-in design reference as post
artwork.
