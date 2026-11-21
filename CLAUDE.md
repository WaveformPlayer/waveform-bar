# CLAUDE.md — @arraypress/waveform-bar

Persistent bottom-bar player singleton: `window.WaveformBar.init(config)`. Embeds one
self-mode `WaveformPlayer`, and drives inline `external`-mode players on the page via
`data-wb-*` triggers.

## Commands
- `npm test` — vitest (run before committing).
- `npm run build` — iife + esm + min + css. `prepublishOnly` runs it.
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

## Architecture (`src/js/`, TypeScript since 2.0)
- `core.ts` — the singleton, `DEFAULTS`, `_initPlayer()`, lifecycle.
- `types.ts` — the public types (`WaveformBarConfig`, tracks, events).
- `actions.ts` — `data-wb-*` trigger wiring. `queue.ts` — track queue.
- `dom.ts` — bar markup. `icons.ts` — inline SVG. `storage.ts` — persistence.
- `utils.ts`, `index.ts` — entry + `window.WaveformBar`.

## Conventions
- **Types are generated (2.0).** `npm run build:types` writes `types/` from the source;
  never hand-edit it. The framework wrappers still hand-declare `WaveformBarConfig`
  in their own `src/types.ts`. Nothing links those types to `DEFAULTS` at build
  time — but each wrapper's `test/config-drift.test.ts` reads this
  repo's `DEFAULTS` from the installed package and fails when a key isn't typed (or
  explicitly excluded). A new config key still means editing all four types; after a
  release, bump the wrappers' devDependency so their drift test sees it.
- Peer dep on `@arraypress/waveform-player@^1.x`; `dist/` is committed.
- Logging prefix `[WaveformBar]`.
- **A hidden surface must be unfocusable, not just moved.** The bar toggles `inert` in lockstep with `.wb-active` (`_createBar()` sets it, `show()`/`hide()` flip it) and its idle CSS state is `visibility: hidden` with a matching transition; the queue panel and volume popup rely on `visibility: hidden` when closed. Transform/opacity alone leaves controls in the tab order. `test/css.test.js` pins the CSS half.

## Cross-repo
An option change here is usually part of a 15-package family batch —
load the `waveform-release` skill rather than editing this repo alone.
