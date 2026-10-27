# SSH Control Center — Design System "Relic Night" (v6)

A black sky over the fleet. The sky keeps local time, the hour's colour gathers at the horizon, stars stay visible all day.
The fleet stands on the land as ribbed pods; light runs down the wires when a host changes state. The rainbow lives only where you point.
Dreamy where it is sky, precise where it is data.

Supersedes "Engraved Violet" (`DESIGN-v5.md`, kept for reference). The prototype that settled every value below is
`B16 · Relic Night` (local `.oil-ui/motion-directions/explore/b16-night.html`, not in git).

## Golden rules (do not break)

1. **One black ground, one sky.** The window is a single near-black gradient. The sky (top of Inventory) and the ground continue
   under the sidebar with no panel, border or seam. Nothing may stop at the sidebar's edge.
2. **Soft lives in the sky, hard lives in the data.** Sky, haze, grain, light leak, blurred faded word, italic "online." are soft.
   Film edge, registration marks, callout block, numerals, tabs, rows, host names are crisp: hairlines, square or 6 px corners, heavy weights.
3. **The rainbow is a response, not a decoration.** The iridescent pearl appears on hover, focus and selection (and on a pointed pod cap).
   Everything at rest is black, silver, steel blue and the sky's own colour.
4. **Steel blue is the accent** (`--steel`). Status colours are status only. No other accent.
5. **Motion has a reason and stops.** It reacts to the fleet (a state change, a recovery) or to the pointer. Nothing loops except the
   breathing online LED, the slow glint ripple and a few twinkling stars, all opacity/transform. Idle budget: **< 1 % of one core**.
6. **Readable at a glance, all day.** Text on the sky and on the ground stays ≥ 7:1 (`--white`, `--lilac`). Muted text is a colour
   token, never opacity. Focus: `outline: 2px solid var(--steel); outline-offset: 3px`. Targets ≥ 44 px. Everything that moves stops
   under `prefers-reduced-motion`.
7. **Unisex, slightly masculine.** Few pinks at rest, tight radii (6 px; pills only for small chips), bold data type.

## Tokens

```css
:root {
  /* ground */
  --ground-0: #07080E;  --ground-1: #0B0C18;  --ground-2: #0E0F1E;   /* window gradient top → bottom */
  --ridge:    #0A0B17;                                               /* near ridge = ground at that height */
  --deep:     #05060E;                                               /* blocks that sit on the sky */
  /* text */
  --white: #EEF0F8;   /* primary text */
  --lilac: #A9AEC8;   /* muted text, labels (≥ 7:1 on --ground-1) */
  --silver: #DCE0F0;  /* faded word, chrome highlights */
  /* accent + status */
  --steel: #8FB0F0;
  --led:   #7CF2C0;   /* online */
  --amber: #FFC266;   /* high load */
  --rose:  #FF7FAE;   /* offline */
  /* lines */
  --rule:  rgba(238,240,248,.12);
  --tint:  rgba(143,176,240,.07);
  /* the rainbow */
  --pearl: linear-gradient(100deg, #BFE4FF 0%, #E4CCF6 32%, #F6D6E4 52%, #CDF2DC 74%, #F4E6C6 100%);
  --pearl-faint: linear-gradient(100deg, rgba(191,228,255,.17) 0%, rgba(228,204,246,.17) 32%, rgba(246,214,228,.14) 52%, rgba(205,242,220,.14) 74%, rgba(244,230,198,.17) 100%);
  --ink-on-pearl: #0B0C18;
  --holo: conic-gradient(from 210deg, #9CFF57, #7CF6FF, #FFFFFF, #FF9CF2, #C3A6FF, #9CFF57);
  --chrome: conic-gradient(from 210deg, #F4F6FB, #A6B4D8, #E8ECF6, #6E7CA8, #DCD6EE, #C9E6EA, #F4F6FB);
}
```

### Sky clock

The sky's four stops (`--sky0` zenith → `--sky3` horizon), the glow colour and the far-ridge colour are interpolated between hour
keyframes (smoothstep) and written to `<body>` **once a minute** from the viewer's local time. The sky and the sidebar both read them.

| From | Phase | sky0 → sky3 | Glow |
|---|---|---|---|
| 00:00 | night | `#04050C #0A0C1E #151A3C #26305E` | `#6C7CFF` |
| 04:18 | pre-dawn | `#04050D #0C0D24 #2A2052 #6E3E7E` | `#C98AD8` |
| 06:12 | sunrise | `#05071A #141A42 #4C3274 #E2805C` | `#FF9A5C` |
| 08:30–13:00 | day | `#050B22 #0E2052 #1E4494 #4E8AD6` | `#9AD0FF` |
| 16:18 | late | `#060A20 #121E4E #2A3A8A #6C72CC` | `#B0A8FF` |
| 18:06 | golden | `#06061A #1A183A #5C3252 #E28C4C` | `#FF8A40` |
| 19:24 | dusk | `#050514 #151232 #3C215A #8C3E7A` | `#C86AC8` |
| 21:00 | night | as 00:00 | |

- Sun: rises 06:00 behind this Master (33 % across the sky), sets 18:36 on the right; a white bloom; faint rays by day.
- Moon: a light crescent on its own arc 19:00 → 05:30.
- Stars: never below 40 % (visible all day), full at night. Dimmer under the sidebar text.
- Fleet health sets the glow's strength (`0.25 + 0.75 × online share³`, 3 s crossfade); offline hosts add a rose-blue chill at the horizon.

## Typography

All bundled (Tauri CSP: no font downloads). All OFL.

| Role | Face | Use |
|---|---|---|
| Headline numeral | Fraunces, `SOFT 0`, `opsz 144`, wght 900, 136 px | "9" in "9 of 11 online." |
| Faded word | Mixed per letter: Cormorant Garamond italic 300 · Fraunces 300 · Space Grotesk 300 · Space Mono — 16 % opacity, 2 px blur | "Inventory" behind the scene |
| Landing word | Cormorant Garamond italic 400, 64 px | "online." — the one soft italic |
| Callout name, logo "SSH" | Fraunces `SOFT 0`, 500–800 | |
| UI: host names, menu, tabs, buttons | Instrument Sans 600–700 (Space Grotesk for menu/status caps, letter-spacing .14–.18em) | |
| Data: IPs, facts, film edge, labels | JetBrains Mono / Space Mono 11–13 px | |

Cormorant ships old-style figures only; its digits come from Fraunces (`unicode-range: U+0030-0039` face).
Thai: Bai Jamjuree + Anuphan stay until a Relic pairing is tested (candidates: Trirong for display, IBM Plex Sans Thai Looped for UI).

## Layout (main screen)

1. **Sidebar** — 236 px, transparent over the window ground. The sky continues under it, cut by a curve that carries the near ridge
   (meets the plate's ridge at 416 px). Top → bottom: stacked logo (SSH / Control / CENTER), Add host (6 px, hairline), filter (6 px,
   faint fill), menu (each row a faint pill; the active one pearl with a dark dot), host tree with curved connectors, current Master + round-cornered Refresh.
2. **Sky plate** — 500 px, top of Inventory. Film edge (30 px, perforations, real readouts: online/total, Master, IP, last poll, offline),
   registration marks, faded word, the topology on a tilted floor (pods, curved wires, rings, halo), headline bottom-left, callout on the
   pointed host. The plate's bottom 30 px fade into the ground.
3. **Below the sky** — square ink tabs (All / Direct / Via <Master> / Needs a look), host rows in two columns on hairlines.
4. **Host / Master pages** — same ground and sidebar; no sky plate (a 120 px sky strip at most).

## Components

| Component | Rest | Hover / focus | Selected |
|---|---|---|---|
| Host row | hairline below, white name, lilac IP | `--pearl-faint`, text stays light | `--pearl-faint` + 3 px pearl left edge |
| Tab | square, 1.5 px rule border | `--pearl`, dark ink | `--pearl`, dark ink |
| Menu row | faint pill `rgba(238,240,248,.035)` | `--pearl` | `--pearl` + dark dot |
| Button (primary) | 6 px, hairline white | `--pearl`, dark ink | — |
| Callout | frosted ink block (`rgba(10,11,24,.72)` + 10 px backdrop blur), square, inner hairline, straight elbow leader, square terminal | — | — |
| Pod | stacked discs, hairline edges; Master taller, chrome cap; every 4th Master disc steel | lifts 10 px, cap `--holo` | — |
| Status dot | 9 px round in its colour (7 px in the tree) | | |

## Motion (all event-driven, all transform/opacity)

- State change: a short light runs along the curved wire from this Master to the host (0.9–1.5 s), ping on arrival, the row flashes once.
- Recovery: one shooting star across the upper sky.
- Count change: the numeral flexes (weight/axis + skew, 0.9 s); the faded word's letters re-roll their faces one by one.
- Pointer: 8 parallax layers (stars, word, far ridge, glow, scene, callout, glint, near ridge), eased, one rAF per move; the callout glides (560 ms).
- Always on (cheap): online LED breathing, glint ripple under this Master (7 s), ≤ 6 twinkling stars (8–12 s).
- Nothing runs while the window is hidden. Nothing moves under `prefers-reduced-motion`.

## Implementation notes

- Tauri CSP `style-src 'self'`: no `style=""` attributes. Set custom properties through CSSOM (`el.style.setProperty`).
- Grain and the light leak use `data:` SVG backgrounds in the prototype — check `img-src` before shipping, or ship them as files.
- `backdrop-filter` only on a few static blocks (callout, film edge, preview controls).
- Six font families: subset before shipping.
- **Text over the sky** — near the horizon the sky gets light (white is only 2.5–3:1 on sunrise/day `--sky3`), so text there
  carries a local scrim: the sidebar's copy of the sky darkens below 38 % of its height, and the headline has a soft radial scrim
  plus a dark halo. Measured 2026-10-27 at 02:00, 05:00, 06:36, 10:00, 13:00, 17:36 and 19:00 (95th-percentile background behind
  the text): headline white 7.3–11.3:1, sidebar tree 8.4–10.5:1.
- Latency and uptime are not in the Master's data yet; the callout shows address, system and when it was last checked.
- `sky.js` builds the sky once outside `#main` and only updates it (app.js `syncSky()`), so a running light survives re-renders.
