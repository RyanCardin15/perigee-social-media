# Perigee Social Media

This workspace turns point-for-point matched Perigee and NOAA tide data into
complete Codex-generated Instagram slides, validates their provenance and
factual contract, stages public JPEGs, and publishes through Meta's authorized
Content Publishing API.

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
```

`social:prepare` stops at `awaiting-generation` and writes
`generation-brief.json` with five exact, data-bound prompts. Run Codex built-in
image generation separately for each prompt. Inspect every generated word,
number, chart point, safe area, and prediction boundary; regenerate failures.
`social:attach --confirm-reviewed` accepts only the five reviewed image outputs
and limits post-processing to orientation, 1080×1350 sizing, and JPEG encoding.
Validation records the prompt and source-image checksums and rejects missing or
non-Codex provenance.

Publishing remains a separate explicit gate:

```bash
cp .env.example .env.local
( set +x; trap 'pbcopy </dev/null' EXIT; pbpaste | npm run token:install -- --confirm )
npm run check:env
npm run token:status
npm run account:verify
npm run publish -- --manifest content/posts/<post-id>/manifest.json --confirm
```

Never paste tokens into chat, captions, manifests, Git history, or logs. The
publisher refuses drafts, failed validation, wrong accounts, exhausted quota,
remote-byte mismatches, and duplicate post IDs. It journals publication state
so ambiguous Meta responses can be reconciled without duplicate posts.

Long-lived Instagram tokens expire after roughly 60 days. The install command
records lifecycle metadata. Check it with `npm run token:status` and rotate an
eligible token with `npm run token:refresh -- --confirm`. Both `.env.local` and
token metadata stay outside Git.
