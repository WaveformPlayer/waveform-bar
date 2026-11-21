import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * jsdom does no layout or cascade, so nothing else in the suite reads the
 * stylesheet. The play glyph's optical centring is the kind of one-line rule
 * that gets dropped in a refactor and only resurfaces as a bug report, so it is
 * pinned here alongside the geometry that justifies it.
 *
 * @see ../src/css/waveform-bar.css
 * @see https://github.com/WaveformPlayer/waveform-bar/issues/1
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/css/waveform-bar.css'), 'utf8');
const ICONS = readFileSync(resolve(process.cwd(), 'src/js/icons.js'), 'utf8');

describe('play button optical centring', () => {
	it('renders the icon svgs as blocks, so no baseline gap lifts them', () => {
		// The glyphs sit in `display: block` spans; an inline svg in there rides the
		// text baseline and the line box's descender space pushes it ~3px above the
		// circle's centre (reported against 1.12.0).
		expect(CSS).toMatch(/\.wb-play svg\s*\{[^}]*display:\s*block/);
	});

	it('nudges the play triangle right of the flexbox centre', () => {
		expect(CSS).toMatch(/\.wb-icon-play svg\s*\{[^}]*margin-left:\s*1px/);
	});

	it('leaves the symmetric pause glyph alone', () => {
		expect(CSS).not.toMatch(/\.wb-icon-pause svg\s*\{[^}]*margin-left/);
	});

	it('matches the correction waveform-player applies to the same glyph', () => {
		// Both components draw the identical path, so a nudge in one and not the
		// other is exactly the inconsistency that was reported.
		const player = ICONS.match(/play:\s*'([^']+)'/)[1];
		expect(player).toContain('M8 5v14l11-7z');
	});

	it('still centres the icon box itself', () => {
		// The nudge is an adjustment to centring, not a replacement for it —
		// removing the flex centring would move the glyph far more than 1px.
		expect(CSS).toMatch(/\.wb-btn\s*\{[^}]*align-items:\s*center/);
		expect(CSS).toMatch(/\.wb-btn\s*\{[^}]*justify-content:\s*center/);
	});
});

describe('queue keyboard affordances', () => {
	it('reveals the remove button when the row has keyboard focus, not only on hover', () => {
		expect(CSS).toMatch(/\.wb-queue-item:focus-within \.wb-queue-remove/);
	});

	it('resets the skip button so it lays out like the old row text', () => {
		expect(CSS).toMatch(/\.wb-queue-skip\s*\{[^}]*font:\s*inherit/);
		expect(CSS).toMatch(/\.wb-queue-skip:focus-visible/);
	});
});

/**
 * Hidden surfaces must also be unfocusable. Transform + opacity only move or
 * fade a box — its controls stay in the tab order — so every closed state
 * carries `visibility: hidden` (which removes it from focus and the a11y tree)
 * with a visibility transition, so the close animation still plays.
 */
describe('hidden surfaces are unfocusable', () => {
	// Every rule whose selector is exactly `sel`, at the start of a line (so
	// `.wb-light .wb-queue-panel` or a grouped token block doesn't count).
	const rules = (sel) => [...CSS.matchAll(
		new RegExp('\\n' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}', 'g'),
	)].map((m) => m[1]).join('\n');

	it('hides the idle bar, and transitions visibility with the slide', () => {
		const idle = rules('.waveform-bar');
		expect(idle).toMatch(/visibility:\s*hidden/);
		expect(idle).toMatch(/transition:[^;]*visibility\s+0\.5s/);
		expect(rules('.waveform-bar.wb-active')).toMatch(/visibility:\s*visible/);
	});

	it('hides the closed queue panel and volume popup', () => {
		expect(rules('.wb-queue-panel')).toMatch(/visibility:\s*hidden/);
		expect(rules('.wb-queue-panel.wb-queue-open')).toMatch(/visibility:\s*visible/);
		expect(rules('.wb-volume-popup')).toMatch(/visibility:\s*hidden/);
		expect(rules('.wb-volume-popup.wb-volume-open')).toMatch(/visibility:\s*visible/);
	});
});
