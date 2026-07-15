# Perigee Feed System v1

Perigee's feed should feel like a premium coastal field guide: cinematic at
first glance, exact on inspection, and calm enough to trust. Every carousel
uses one Codex-generated editorial image plus deterministic data composition.

## Creative idea: Signal in the water

The opening image translates the post's verified tide signal into a
non-documentary ocean study. Water texture supplies emotion; Perigee's renderer
supplies every word, number, chart, logo, and attribution. Generated imagery
must never depict local conditions, station geography, flooding, warnings, or
provider marks.

The five-slide story is fixed:

1. **Hook** — editorial water image, concise signal, and the predicted high.
2. **Signal** — exact height, datum, station-local time, date, and station.
3. **Curve** — the matched seven-day NOAA/Perigee trace.
4. **Meaning** — Perigee's station-specific top-1% threshold or weekly range.
5. **Action** — prediction/observation boundary, source, disclaimer, and CTA.

## Visual language

- **Canvas:** 1080×1350 (4:5), with 72 px working margins and all critical
  content inside Instagram's 90/100 px safe areas.
- **Palette:** deep ocean ink `#071d2a`, warm foam `#faf9f4`, tide teal
  `#0099a8`, signal magenta `#c41e6a`, light magenta `#ff70ad`, and threshold
  brass `#a06a0a`.
- **Type:** Newsreader Semibold Italic for editorial headlines and hero values;
  Public Sans Regular/Semibold for facts, labels, and navigation.
- **Shape:** large 38–46 px card radii, fine orbital/tidal contour lines, strong
  asymmetry, and generous negative space.
- **Contrast:** warm foam on deep ink for story slides; deep ink on warm foam
  for data surfaces. Accent color is semantic, never decorative noise.

## Image direction

Codex built-in image generation is the only approved generator. Each post's
`creative-brief.json` is data-derived and records the exact prompt. The image
must be a text-free editorial metaphor with real water microtexture, controlled
light, open copy space, and the Perigee palette.

Always avoid text, numbers, charts, maps, axes, recognizable places, buildings,
boats, people, animals, storm damage, flood imagery, giant waves, stock
sunsets, tropical color, fantasy effects, and watermarks. The generated art is
never evidence; it only sets the visual register.

## Consistency and engagement rules

- Lead with one claim, one number, and one action per slide.
- Use a visual change between dark story surfaces and light data cards to
  reward swiping while preserving one identity.
- Keep headlines under three lines and labels under 24 characters where
  possible.
- Never shrink regulatory or source language below the renderer's defined
  sizes to make more copy fit.
- Do not add engagement bait, urgency, sensational weather, or unsupported
  safety language.
- Review the generated image and all five rendered JPEGs before staging.

## Production contract

`social:prepare` freezes matched data and writes the brief. Codex generates and
inspects the editorial source. `social:compose` copies that source into the post,
records its generator, prompt hash, dimensions, and checksum, then renders and
validates the carousel. A post cannot validate without Codex artwork provenance.
