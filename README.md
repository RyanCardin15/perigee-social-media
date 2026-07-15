# Perigee Social Media

This workspace turns NOAA-backed tide data into deterministic Perigee social
assets, validates every factual claim, stages public JPEGs, and publishes an
Instagram carousel through Meta's authorized Content Publishing API.

The reusable operating contract is
`skills/perigee-social-publisher/SKILL.md`. Generated text and charts never come
from an image model; heights, dates, labels, and the plotted curve are rendered
from matched Perigee and NOAA responses.

## Local workflow

```bash
npm install
npm run social:prepare -- --mode launch --date 2026-07-15
npm run validate -- --manifest content/posts/2026-07-15-golden-gate-king-tide/manifest.json
npm run stage -- --manifest content/posts/2026-07-15-golden-gate-king-tide/manifest.json
```

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
