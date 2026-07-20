# Perigee Social Media

This workspace turns point-for-point matched Perigee and NOAA tide data into
complete Codex-generated social slides, validates their provenance and factual
contract, stages public JPEGs, and publishes the same reviewed assets to the
owned Instagram Business account and Facebook Page through Meta APIs.

The reusable operating contract is
`skills/perigee-social-publisher/SKILL.md`. [Perigee Feed System v2](design-system/FEED_SYSTEM.md)
defines the visual identity. Codex built-in image generation creates every
finished slide: background, typography, data presentation, chart, information
design, and all visible copy. The pipeline does not build posts with SVG, PNG
overlays, templates, or a deterministic renderer.

## Local workflow

```bash
npm install
npm run token:status
npm run account:verify
npm run social:prepare -- --mode weekly --date YYYY-MM-DD
npm run social:attach -- --manifest content/posts/<post-id>/manifest.json \
  --slide-1 <codex-image> --slide-2 <codex-image> --slide-3 <codex-image> \
  --slide-4 <codex-image> --slide-5 <codex-image> --confirm-reviewed
npm run validate -- --manifest content/posts/<post-id>/manifest.json
npm run stage -- --manifest content/posts/<post-id>/manifest.json
npm run dry-run -- --manifest content/posts/<post-id>/manifest.json
```

`social:prepare` stops at `awaiting-generation` and writes
`generation-brief.json` with five exact, data-bound prompts. Run Codex built-in
image generation separately for each prompt. Inspect every generated word,
number, chart point, safe area, and prediction boundary; regenerate failures.
`social:attach --confirm-reviewed` accepts only the five reviewed image outputs
and limits post-processing to orientation, 1080×1350 sizing, and JPEG encoding.
Validation records the prompt and source-image checksums and rejects missing or
non-Codex provenance.

New manifests also freeze a local-discovery plan and platform captions: a locality-first caption,
local search phrases, 5–10 focused hashtags, and an Instagram place candidate.
To target a specific station, add `--station <NOAA station ID>` to
`social:prepare`. Verified Instagram place IDs may be configured in
`config/pipeline.json` under `discovery.locationIds`; otherwise the dry-run and
scheduled workflow require a manual existing-place tag after publication.

`npm run dry-run` is the final no-publish gate. It requires a staged, valid
manifest, writes `dry-run-report.json`, previews the exact Instagram carousel
and Facebook multi-photo payloads plus location handling, and performs no Meta
or publication-state writes.

Publishing remains a separate explicit gate:

```bash
cp .env.example .env.local
npm run facebook:configure -- --page-id <id> --page-name "Perigee Tides" --page-handle perigeetides --confirm
( set +x; trap 'pbcopy </dev/null' EXIT; pbpaste | npm run token:install -- --confirm )
( set +x; trap 'pbcopy </dev/null' EXIT; pbpaste | npm run facebook-token:install -- --confirm --expires-at never --data-access-expires-at <ISO-8601> )
npm run check:env
npm run token:status
npm run facebook-token:status
npm run account:verify
npm run publish -- --manifest content/posts/<post-id>/manifest.json --confirm
```

Never paste tokens into chat, captions, manifests, Git history, or logs. The
publisher refuses drafts, failed validation, wrong accounts, exhausted quota,
remote-byte mismatches, and duplicate platform entries. Instagram and Facebook
use separate journals so an ambiguous response can be reconciled without
duplicating either live post.

Long-lived Instagram tokens expire after roughly 60 days. The install command
records lifecycle metadata. Check it with `npm run token:status` and rotate an
eligible token with `npm run token:refresh -- --confirm`. Both `.env.local` and
token metadata stay outside Git.

The Facebook Page token is also stored only in `.env.local`; its hash, token
lifetime, and Meta data-access lifetime are recorded under `state/private/`.
`facebook-token:status` warns within 14 days of either expiry, while
`account:verify` checks the exact Page ID, name, optional username, and public
link on every preflight. Obtain both lifetime values from Meta's Access Token
Debugger; do not install a token with unknown lifecycle metadata.
