/**
 * @module utils
 * @description Utility functions for WaveformBar
 */
import type { WaveformBarMarker, WaveformBarTrack } from './types.js';
/**
 * Extract a display title from a URL
 * @param url
 */
export declare function extractTitle(url: string): string;
/**
 * Escape HTML to prevent XSS
 * @param str
 */
export declare function escapeHtml(str: unknown): string;
/**
 * Format seconds to M:SS.
 *
 * Falsy, non-numeric, non-finite and negative inputs all render as `'0:00'`.
 * `Infinity` is the one that bites: a streamed or unseekable source reports
 * `audio.duration === Infinity`, which is truthy and not `NaN`, and
 * `Infinity % 60` is `NaN` — so the old guard put a literal `'Infinity:NaN'`
 * in the bar's time display.
 *
 * Note this stays M:SS past an hour (a 65-minute track reads `65:00`), unlike
 * the core player's `formatTime`, which rolls over to H:MM:SS.
 * @param seconds
 */
export declare function formatTime(seconds: unknown): string;
/**
 * A track's `duration` as seconds, or `undefined` when it isn't a usable
 * length. Accepts a number of seconds (`187`), a numeric string (`'187'`,
 * `'187.5'`, as `data-duration` gives it) or a clock string (`'3:07'`,
 * `'1:02:03'`) — 1.x documented `duration` as a display string, so pages
 * written for it still give the player a real length. Anything else, and
 * anything not greater than 0, is `undefined`.
 * @param value
 */
export declare function parseDuration(value: unknown): number | undefined;
/**
 * Coerce a markers value to an array of marker objects with a finite numeric
 * `time`. Anything else — a string, `null` entries, an unparseable time — is
 * dropped, because downstream code `.map()`s the array and reads `m.color` /
 * `m.time` off every entry without further checks.
 * @param value
 */
export declare function sanitizeMarkers(value: unknown): WaveformBarMarker[];
/**
 * Shape any incoming track object into a queue entry. Every path that puts a
 * track in the queue — play(), addToQueue(), request-play, session restore —
 * goes through here so they can't disagree about what a track looks like.
 *
 * Caller-supplied fields are kept (they're returned by getQueue() and passed
 * to callbacks), minus `player` and null/undefined values; `markers` is
 * sanitized and a `waveform` that isn't peaks (array) or a URL/JSON string is
 * dropped. With `fromPlayer`, only {@link PLAYER_DETAIL_FIELDS} are read.
 *
 * @param input
 * @param opts
 * @returns null when there's no usable url
 */
export declare function normalizeTrack(input: any, { fromPlayer }?: {
    fromPlayer?: boolean;
}): WaveformBarTrack | null;
/**
 * Merge fresh track data into an existing queue entry. Empty values (null,
 * undefined, '', []) never overwrite: a sparse source — an inline player with
 * no title, a trigger with no artwork — must not wipe what's already queued.
 * @param base
 * @param update
 */
export declare function mergeTrack(base: WaveformBarTrack, update: Partial<WaveformBarTrack> | null | undefined): WaveformBarTrack;
/**
 * Parse track metadata from a trigger element
 * @param el
 */
export declare function parseTrackFromElement(el: HTMLElement): WaveformBarTrack | null;
//# sourceMappingURL=utils.d.ts.map