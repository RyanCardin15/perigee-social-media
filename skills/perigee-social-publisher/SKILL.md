---
name: perigee-social-publisher
description: Prepare, validate, stage, and publish factual Perigee Tides social posts from NOAA and Perigee data. Use for scheduled Instagram content, weekly tide carousels, king-tide prediction posts, tide education, caption and alt-text generation, social asset validation, or Meta Content Publishing API delivery for Perigee.
---

# Perigee Social Publisher

Produce useful coastal-planning posts while keeping every number, time, chart,
and interpretation traceable to authoritative data.

## Workflow

1. Read `references/content-contract.md` before writing or approving copy.
2. Read `references/meta-api.md` before configuring or repairing publication.
3. Check `state/publishing-ledger.jsonl` and do not recreate or republish an
   existing post ID.
4. Run the appropriate preparation mode from the project root:

   ```bash
   npm run social:prepare -- --mode weekly --date YYYY-MM-DD
   npm run social:prepare -- --mode event-watch --date YYYY-MM-DD
   npm run social:prepare -- --mode launch --date 2026-07-15
   ```

5. Inspect the generated manifest and validation report. Stop if Perigee and
   NOAA values do not match point-for-point or any validation fails.
6. Inspect all rendered slides. Keep factual text, axes, and chart geometry
   deterministic. Do not ask an image model to draw numbers, labels, charts,
   station geography, warnings, or provider marks.
7. Stage verified JPEGs with `npm run stage -- --manifest <path>`. Public URLs
   must return `200` and `image/jpeg` before API publication.
8. Apply the review policy in `config/pipeline.json`. Require a human for
   observations, advisories, flooding claims, or safety incidents. A matched,
   prediction-only weekly or king-tide post may publish automatically.
9. Publish only with an explicit gate:

   ```bash
   npm run publish -- --manifest <path> --confirm
   ```

10. Verify the returned media ID, live permalink, caption, slide order, and
    ledger entry. Do not report success from container creation alone.

## Required boundaries

- Say **predicted high/low** for astronomical predictions; never relabel them
  as observations, surge, flooding, or conditions at a beach.
- Use station-local time and identify feet above local MLLW.
- Describe Perigee's king-tide threshold as its top-1% definition. NOAA does
  not publish one universal king-tide threshold.
- Never say safe, all clear, guaranteed, real-time, or navigation-grade.
- Include NOAA attribution, the station ID, the prediction/observation
  boundary, and the planning-aid disclaimer.
- Never store access tokens, app secrets, passwords, verification codes, or
  exact private user data in manifests, Git, captions, logs, or automation
  prompts.
- Do not automate account signup, terms acceptance, CAPTCHA, age verification,
  identity challenges, or developer registration. Hand those steps to the
  account owner and resume after completion.

## Failure handling

- On provider mismatch, stale or missing data, render failure, inaccessible
  media, permission failure, expired token, or ambiguous station identity:
  leave the post unpublished, preserve the draft, and report the exact failed
  gate without leaking provider payloads or credentials.
- If no candidate is genuinely noteworthy, publish nothing. A quiet run is a
  successful outcome.
- Refresh long-lived Instagram authorization before expiry; never replace a
  failed token with browser scraping or password automation.

## Exit criteria

Finish only when source matching, visual inspection, validation, public-media
availability, publish response, live-post verification, and ledger recording
all agree. A generated draft is not a published post.
