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
# Fill the Instagram account ID and long-lived access token locally.
npm run check:env
npm run publish -- --manifest content/posts/<post-id>/manifest.json --confirm
```

Do not paste tokens into chat, captions, manifests, Git history, or logs. The
publisher refuses drafts, failed validation, inaccessible public media, and
duplicate post IDs. See the skill references for factual language and Meta API
requirements.
