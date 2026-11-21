# CLAUDE.md — @arraypress/waveform-bar

Persistent bottom-bar player singleton: `window.WaveformBar.init(config)`. Embeds one
self-mode `WaveformPlayer`, and drives inline `external`-mode players on the page via
`data-wb-*` triggers.

## Commands
- `npm test` — vitest (run before committing).
- `npm run build` — iife + esm + min + css + types. `prepublishOnly` runs it.
  esbuild reads `tsconfig.json` (strict), so every bundle is strict mode; there
  is no separate esbuild tsconfig any more.
- `npm run typecheck` (`tsc -p .`), `npm run lint` (Biome).
- `npm run size` — gzipped JS/CSS.
- `npm run dev` — watch build.

## The rule that matters: config is an allowlist, not a spread

Adding a config key takes **two** edits in `src/js/core.ts` (plus its type in `src/js/types.ts`), and skipping the second
fails **silently** — no error, the option just never reaches the player:

1. Add the key to the `DEFAULTS` object.
2. Add a forward line in `_initPlayer()`, next to the colour forwards:
   ```js
   if (this.config.<key>) opts.<key> = this.config.<key>;
   ```

There is no spread of `this.config` into `opts` anywhere — if it isn't on that list,
it doesn't propagate. Grep `opts\.\w* = this\.config` to see the full current set.

**Deliberately not forwarded** (2.0 core options; the comment under the forward
lines says why): `showLoop`, `showVolume`, `showDownload` (the bar hides the
player's info row and has its own repeat and volume), `loop` (repeat 'one' does
it, and a looping `<audio>` never fires `ended`, which drives the queue) and
`lazy` (the embedded player has nothing to load until the bar loads a track).
Don't add them to `DEFAULTS`.

**Per-track options go through `loadTrack()`, not config.** `waveform` (peaks:
array, `wp1:` string, URL/JSON string — the bar never validates a peaks string,
the core decodes it), `markers`, and `duration` (`parseDuration()` in
`utils.ts`: seconds or a clock string; left out when unusable so the core resets
the previous track's). There are three load paths — `_loadCurrentTrack()`,
`_restoreState()`, `_loadSharedTrack()` — and each builds its own `loadOpts`.

## Architecture (`src/js/`, TypeScript since 2.0)
- `core.ts` — the singleton, `DEFAULTS`, `_initPlayer()`, lifecycle.
- `types.ts` — the public types (`WaveformBarConfig`, tracks, events).
- `actions.ts` — favourite/cart endpoint calls. `queue.ts` — queue panel.
  `data-wb-*` triggers are read by `parseTrackFromElement()` in `utils.ts`.
- `dom.ts` — bar markup. `icons.ts` — inline SVG. `storage.ts` — persistence.
- `utils.ts` (track parsing/normalising, `parseDuration`, `formatTime`),
  `index.ts` — entry + `window.WaveformBar`.
- Theme detection and URL safety are the core's (`window.WaveformPlayer.utils`
  `.detectColorScheme` / `.isSafeHref`); the bar keeps no copies since 2.0.

## Conventions
- **Types are generated (2.0).** `npm run build:types` writes `types/` (with
  declaration maps into the shipped `src/`) from the source; never hand-edit it.
  `types/` needs no `package.json` of its own: the package is `"type": "module"`.
  The framework wrappers still hand-declare `WaveformBarConfig`
  in their own `src/types.ts`. Nothing links those types to `DEFAULTS` at build
  time — but each wrapper's `test/config-drift.test.ts` reads this
  repo's `DEFAULTS` (`const DEFAULTS = {` in `src/js/core.ts`) from the installed
  package and fails when a key isn't typed (or explicitly excluded). The
  `exports` map doesn't expose `src/`, so they must read the file from disk
  (resolve `@arraypress/waveform-bar/package.json`), not import it. A new config
  key still means editing all four types; after a release, bump the wrappers'
  devDependency so their drift test sees it.
- **Package (2.0)**: ESM only (`"type": "module"`, no CJS build, no `module`
  field); `main` and `exports["."]` are `dist/waveform-bar.esm.js`; `unpkg` /
  `jsdelivr` are the minified IIFE. `exports` also has `./styles.css`,
  `./dist/*` (every documented CDN/import path is under `dist/`) and
  `./package.json`. `engines.node >=22.12`. `src/` ships only because of the
  declaration maps.
- Peer dep on `@arraypress/waveform-player@^2.0.0`; the devDependency is
  `file:../waveform-player` while 2.0 is unpublished. `dist/` and `types/` are
  committed.
- Browser floor: Chrome/Edge 111, Firefox 114, Safari 16.4; tsconfig target
  ES2022. Guards that remain (`ResizeObserver`, `matchMedia`,
  `navigator.clipboard`) are for jsdom and insecure contexts, not old browsers.
- Logging prefix `[WaveformBar]`.
- **A hidden surface must be unfocusable, not just moved.** The bar toggles `inert` in lockstep with `.wb-active` (`_createBar()` sets it, `show()`/`hide()` flip it) and its idle CSS state is `visibility: hidden` with a matching transition; the queue panel and volume popup rely on `visibility: hidden` when closed. Transform/opacity alone leaves controls in the tab order. `test/css.test.js` pins the CSS half.

## Cross-repo
An option change here is usually part of a 15-package family batch —
load the `waveform-release` skill rather than editing this repo alone.
