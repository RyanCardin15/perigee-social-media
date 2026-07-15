---
name: perigee-social-publisher
description: Prepare, validate, stage, publish, recover, and maintain authorization for factual Perigee Tides Instagram posts from NOAA and Perigee data. Use for scheduled weekly tide carousels, king-tide predictions, tide education, caption and alt-text generation, social asset validation, Meta Content Publishing API delivery, account verification, ambiguous-publish recovery, publishing quota checks, or long-lived Instagram token maintenance for Perigee.
---

# Perigee Social Publisher

Produce useful coastal-planning posts while keeping every number, time, chart,
and interpretation traceable to authoritative data.

## Workflow

1. Read `references/content-contract.md` before writing or approving copy.
2. Read `references/meta-api.md` before configuring or repairing publication.
3. Check `state/publishing-ledger.jsonl` and `state/publishing/<post-id>.json`.
   Do not recreate or republish an existing post ID.
4. Run the appropriate preparation mode from the project root. This freezes
   the matched data and writes `creative-brief.json`; it intentionally stops at
   `awaiting-artwork`:

   ```bash
   npm run social:prepare -- --mode weekly --date YYYY-MM-DD
   npm run social:prepare -- --mode event-watch --date YYYY-MM-DD
   npm run social:prepare -- --mode launch --date 2026-07-15
   ```

5. Use Codex built-in image generation with the exact prompt in
   `creative-brief.json`. Codex must inspect the result against the brief. Do
   not call image generation programmatically from the publishing scripts or
   substitute stock search or another generator. Generated artwork is a
   non-documentary editorial metaphor only.
6. Compose the post with the reviewed image:

   ```bash
   npm run social:compose -- --manifest content/posts/<post-id>/manifest.json --artwork <codex-generated-image>
   ```

7. Inspect the manifest, validation report, and all rendered slides. Stop if
   Perigee and NOAA values do not match point-for-point or any validation fails.
   Keep factual text, axes, and chart geometry deterministic. Do not ask the
   image model to draw numbers, labels, charts, maps, station geography,
   warnings, or provider marks.
8. Stage verified JPEGs with `npm run stage -- --manifest <path>`. The publisher
   must GET each public URL, require JPEG over HTTPS, and match the remote bytes
   to the local SHA-256 before API publication.
9. Apply the review policy in `config/pipeline.json`. Require a human for
   observations, advisories, flooding claims, or safety incidents. A matched,
   prediction-only weekly or king-tide post may publish automatically.
10. Verify secure configuration, the exact Business account, live quota, and
   token lifecycle before the first publish:

   ```bash
   ( set +x; trap 'pbcopy </dev/null' EXIT; pbpaste | npm run token:install -- --confirm )
   npm run check:env
   npm run token:status
   npm run account:verify
   ```

11. Publish only with an explicit gate:

   ```bash
   npm run publish -- --manifest <path> --confirm
   ```

12. Verify the returned media ID, live permalink, caption, slide order,
    publication journal, and ledger entry. Do not report success from container
    creation alone.

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
- Install a newly generated token only through `npm run token:install -- --confirm`
  on piped stdin. Interactive pasting is rejected; the command
  writes atomically with mode `0600`, records lifecycle metadata, and never
  echoes the credential.
- Do not automate account signup, terms acceptance, CAPTCHA, age verification,
  identity challenges, or developer registration. Hand those steps to the
  account owner and resume after completion.
- Require `/me` to match the configured account ID, username, and `Business`
  type before creating a media container.

## Failure handling

- On provider mismatch, stale or missing data, render failure, inaccessible
  media, permission failure, expired token, or ambiguous station identity:
  leave the post unpublished, preserve the draft, and report the exact failed
  gate without leaking provider payloads or credentials.
- If no candidate is genuinely noteworthy, publish nothing. A quiet run is a
  successful outcome.
- Refresh long-lived Instagram authorization before expiry; never replace a
  failed token with browser scraping or password automation.
- If publication returns an ambiguous result, preserve the per-post journal and
  rerun the same command. Let it reconcile recent account media and resume live
  verification. Never delete the journal or resubmit through another path.
- If a per-post lock exists, stop. Another publisher owns that attempt.

## Token maintenance

- Run `npm run token:status` on a schedule.
- When the status is `refresh-due`, run `npm run token:refresh -- --confirm`.
- Keep `.env.local` and `state/private/` outside Git. Never print the token.
- If refresh fails or the token is expired, publish nothing and request human
  reauthorization through Instagram Login.

## Exit criteria

Finish only when source matching, visual inspection, validation, public-media
availability, publish response, live-post verification, and ledger recording
all agree. A generated draft is not a published post.
