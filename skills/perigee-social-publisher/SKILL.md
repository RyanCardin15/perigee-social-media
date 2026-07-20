---
name: perigee-social-publisher
description: Prepare, validate, stage, publish, recover, and maintain authorization for factual Perigee Tides Instagram and Facebook posts from NOAA and Perigee data. Use for scheduled weekly tide carousels, king-tide predictions, tide education, platform captions and alt text, social asset validation, Meta API delivery, account verification, ambiguous-publish recovery, quota checks, or token maintenance for Perigee.
---

# Perigee Social Publisher

Produce useful coastal-planning posts while keeping every number, time, chart,
and interpretation traceable to authoritative data.

## Workflow

1. Read `references/content-contract.md` before writing or approving copy.
2. Read `references/meta-api.md` before configuring or repairing publication.
3. Check `state/publishing-ledger.jsonl`, the Instagram journal at
   `state/publishing/<post-id>.json`, and the Facebook journal at
   `state/publishing/facebook/<post-id>.json`. Do not recreate an existing post
   ID or republish a platform that already has a `live-verified` entry. If one
   platform is complete and the other is pending, resume only the missing side
   through the same `npm run publish` command.
4. Run the appropriate preparation mode from the project root. This freezes
   the matched data and writes `generation-brief.json`; it intentionally stops
   at `awaiting-generation`:

   ```bash
   npm run social:prepare -- --mode weekly --date YYYY-MM-DD
   npm run social:prepare -- --mode event-watch --date YYYY-MM-DD
   npm run social:prepare -- --mode launch --date 2026-07-15
   ```

   Use `--station <seven-digit NOAA station ID>` for a requested local market
   or deterministic dry run. Preparation must create a discovery plan with a
   locality-first caption, local keywords, 5–10 focused hashtags, at least two
   local hashtags, a useful engagement prompt, and an Instagram location plan.

5. Use Codex built-in image generation once for each of the five exact slide
   prompts in `generation-brief.json`. Every output must be a complete finished
   slide: background, typography, factual data, chart or information design,
   and all visible copy. Codex must inspect every character, number, chart
   point, safe area, and factual boundary against the brief, and regenerate any
   failed slide. Do not call image generation programmatically from the
   publishing scripts or substitute SVG, HTML, canvas, templates, stock search,
   another generator, deterministic overlays, or reused artwork.
6. Attach the five reviewed image outputs:

   ```bash
   npm run social:attach -- --manifest content/posts/<post-id>/manifest.json \
     --slide-1 <codex-image> --slide-2 <codex-image> --slide-3 <codex-image> \
     --slide-4 <codex-image> --slide-5 <codex-image> --confirm-reviewed
   ```

7. Inspect the manifest, validation report, and all five finished slides. Stop
   if Perigee and NOAA values do not match point-for-point, any in-image text or
   plotted data differs from the frozen brief, or any validation fails. The
   attach step may only orient, resize, and JPEG-encode the generated output; it
   must not add or composite content.
8. Stage verified JPEGs with `npm run stage -- --manifest <path>`. The publisher
   must GET each public URL, require JPEG over HTTPS, and match the remote bytes
   to the local SHA-256 before API publication.
9. For a rehearsal, run `npm run dry-run -- --manifest <path>` after staging.
   Require `dry-run-complete`, `externalWritesPerformed: false`, five ordered
   Instagram children, five ordered Facebook photos, and the intended
   hashtag/location handling. This step must never
   create containers, journals, ledger entries, commits, or live posts.
10. Apply the review policy in `config/pipeline.json`. Require a human for
   observations, advisories, flooding claims, or safety incidents. A matched,
   prediction-only weekly or king-tide post may publish automatically.
11. Verify secure configuration, the exact Instagram Business account, the
   exact Facebook Page, live Instagram quota, and token lifecycle before the
   first publish:

   ```bash
   ( set +x; trap 'pbcopy </dev/null' EXIT; pbpaste | npm run token:install -- --confirm )
   ( set +x; trap 'pbcopy </dev/null' EXIT; pbpaste | npm run facebook-token:install -- --confirm --expires-at never --data-access-expires-at <ISO-8601> )
   npm run check:env
   npm run token:status
   npm run facebook-token:status
   npm run account:verify
   ```

12. Publish only with an explicit gate:

   ```bash
   npm run publish -- --manifest <path> --confirm
   ```

13. Verify both returned media IDs, live permalinks, platform captions, five
    assets in order, platform-specific journals, and two ledger entries. Do not
    report success from container or unpublished-photo creation alone.

## Required boundaries

- Say **predicted high/low** for astronomical predictions; never relabel them
  as observations, surge, flooding, or conditions at a beach.
- Use station-local time and identify feet above local MLLW.
- Describe Perigee's king-tide threshold as its top-1% definition. NOAA does
  not publish one universal king-tide threshold.
- Never say safe, all clear, guaranteed, real-time, or navigation-grade.
- Include NOAA attribution, the station ID, the prediction/observation
  boundary, and the planning-aid disclaimer.
- Include a local market label and focused local discovery metadata without
  implying that the station represents citywide or beach conditions.
- Keep Instagram's link-in-bio copy on Instagram. Facebook copy must include
  the direct, `utm_source=facebook` Perigee link and preserve the same factual
  boundaries, discovery prompt, and focused hashtags.
- Tag only an existing Instagram place. Use a configured numeric `location_id`
  when verified; otherwise require a manual existing-place edit after publish
  and verify it on the live post.
- Never store access tokens, app secrets, passwords, verification codes, or
  exact private user data in manifests, Git, captions, logs, or automation
  prompts.
- Install newly generated tokens only through `npm run token:install -- --confirm`
  or `npm run facebook-token:install -- --confirm` on piped stdin. Interactive pasting is rejected; each command
  writes atomically with mode `0600`, records lifecycle metadata, and never
  echoes the credential.
- Do not automate account signup, terms acceptance, CAPTCHA, age verification,
  identity challenges, or developer registration. Hand those steps to the
  account owner and resume after completion.
- Require Instagram `/me` to match the configured account ID, username, and
  `Business` type, and require Facebook `/<PAGE_ID>` to match the configured
  Page ID, name, optional username, and public link before external writes.

## Failure handling

- On provider mismatch, stale or missing data, render failure, inaccessible
  media, permission failure, expired token, or ambiguous station identity:
  leave the post unpublished, preserve the draft, and report the exact failed
  gate without leaking provider payloads or credentials.
- If no candidate is genuinely noteworthy, publish nothing. A quiet run is a
  successful outcome.
- Refresh long-lived Instagram authorization before expiry; never replace a
  failed token with browser scraping or password automation.
- If publication returns an ambiguous result, preserve the platform-specific journal and
  rerun the same command. Let it reconcile recent account media and resume live
  verification. Never delete the journal or resubmit through another path.
- If a per-post lock exists, stop. Another publisher owns that attempt.

## Token maintenance

- Run `npm run token:status`, `npm run facebook-token:status`, and
  `npm run account:verify` on a schedule.
- Run `npm run account:verify` on the same schedule so the Facebook Page token
  and identity are checked even when the Instagram token is not refresh-due.
- When the status is `refresh-due`, run `npm run token:refresh -- --confirm`.
- Keep `.env.local` and `state/private/` outside Git. Never print the token.
- If refresh fails or the token is expired, publish nothing and request human
  reauthorization through Instagram Login.

## Exit criteria

Finish only when source matching, visual inspection, validation, public-media
availability, both publish responses, both live-post verifications, and both
ledger records agree. A generated draft or one-platform-only post is not a
complete scheduled publication.
