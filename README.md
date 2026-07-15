# Perigee Social Media

This workspace turns NOAA-backed tide data into distinctive Perigee social
assets, validates every factual claim, stages public JPEGs, and publishes an
Instagram carousel through Meta's authorized Content Publishing API.

The reusable operating contract is
`skills/perigee-social-publisher/SKILL.md`. [Perigee Feed System v1](design-system/FEED_SYSTEM.md)
defines the visual identity. Codex generates one text-free, non-documentary
editorial image from the verified data brief; all text, numbers, marks, and
charts are rendered deterministically from matched Perigee and NOAA responses.
The checked-in [Golden Gate preview](design-system/examples/golden-gate-v1/slides/01-cover.jpg)
shows the production direction without changing the already-published post.
For copy-paste Codex prompts and the manual handoff, use the
[social post operator runbook](docs/OPERATOR_RUNBOOK.md).

## Local workflow

```bash
npm install
npm run token:status
npm run account:verify
npm run social:prepare -- --mode weekly --date YYYY-MM-DD
npm run social:compose -- --manifest content/posts/<post-id>/manifest.json --artwork <codex-generated-image>
npm run validate -- --manifest content/posts/<post-id>/manifest.json
```

`social:prepare` stops at `awaiting-artwork` and writes
`creative-brief.json`. Give that prompt to Codex built-in image generation,
inspect the result against the checklist, and pass the selected file to
`social:compose`. The compose command records Codex provenance and refuses
published manifests. Validation rejects missing, changed, unreviewed, or
non-Codex artwork.

Publishing is intentionally a separate, explicit gate:

```bash
cp .env.example .env.local
# Fill the Instagram account ID locally. Provide the long-lived token on stdin;
# the install command never echoes it or places it in shell history.
( set +x; trap 'pbcopy </dev/null' EXIT; pbpaste | npm run token:install -- --confirm )
npm run check:env
npm run token:status
npm run account:verify
npm run publish -- --manifest content/posts/<post-id>/manifest.json --confirm
```

Do not paste tokens into chat, captions, manifests, Git history, or logs. The
publisher refuses drafts, failed validation, wrong accounts, exhausted quota,
remote-byte mismatches, and duplicate post IDs. It journals container and
publish state so an ambiguous API response is reconciled on the next run
without resubmitting the post.

Long-lived Instagram tokens expire after roughly 60 days. The install command
records lifecycle metadata. Check it with `npm run token:status` and rotate an
eligible token with `npm run token:refresh -- --confirm`. Both `.env.local` and
token metadata stay outside Git. See the skill references for factual language
and Meta API requirements.
