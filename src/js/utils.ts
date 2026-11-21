/**
 * @module utils
 * @description Utility functions for WaveformBar
 */

import type {WaveformBarMarker, WaveformBarTrack} from './types.js';

/**
 * Extract a display title from a URL
 * @param url
 * @returns 
 */
export function extractTitle(url: string): string {
    if (!url) return 'Untitled';
    return url.split('/').pop()!.split('.')[0]
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Escape HTML to prevent XSS
 * @param str
 * @returns 
 */
export function escapeHtml(str: unknown): string {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str as string;
    return d.innerHTML;
}

/**
 * Whether a URL is safe to navigate to (assign to `location.href`).
 * Allows only `http`/`https` and relative URLs, rejecting `javascript:`,
 * `data:`, `blob:`, `vbscript:` and other script-bearing schemes.
 *
 * TODO(harden): adopt `WaveformPlayer.utils.isSafeHref` once the peer dep
 * is bumped to ^1.8.0 (which ships this helper). Inlined here so the
 * open-redirect / XSS guard is fixed without a peer bump.
 *
 * @param url
 * @returns 
 */
export function isSafeHref(url: unknown): boolean {
    if (typeof url !== 'string' || url === '') return false;
    try {
        // Resolve relative URLs against the current document; only the
        // scheme matters for the safety decision.
        const u = new URL(url, location.href);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

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
 * @returns 
 */
export function formatTime(seconds: unknown): string {
    const total = Number(seconds);
    if (!total || !Number.isFinite(total) || total < 0) return '0:00';
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Coerce a markers value to an array of marker objects with a finite numeric
 * `time`. Anything else — a string, `null` entries, an unparseable time — is
 * dropped, because downstream code `.map()`s the array and reads `m.color` /
 * `m.time` off every entry without further checks.
 * @param value
 * @returns 
 */
export function sanitizeMarkers(value: unknown): WaveformBarMarker[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(m => (m && typeof m === 'object' && !Array.isArray(m)) ? {...m, time: Number(m.time)} : null)
        .filter(m => m && Number.isFinite(m.time)) as WaveformBarMarker[];
}

/**
 * The only fields a player's request-play `detail` contributes. Its `id` is the
 * container's DOM id or a generated `wp_…` key — not a track identity — and
 * `player` is the whole instance, which must never reach the queue (it's
 * persisted to sessionStorage).
 */
const PLAYER_DETAIL_FIELDS = ['url', 'title', 'artist', 'artwork', 'markers', 'waveform'];

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
export function normalizeTrack(input: any, {fromPlayer = false}: {fromPlayer?: boolean} = {}): WaveformBarTrack | null {
    if (!input || typeof input !== 'object' || typeof input.url !== 'string' || !input.url) return null;

    const keys = fromPlayer ? PLAYER_DETAIL_FIELDS : Object.keys(input);
    const track: Record<string, any> = {};
    for (const k of keys) {
        const v = input[k];
        if (v == null || k === 'player') continue;
        track[k] = v;
    }

    if ('markers' in track) track.markers = sanitizeMarkers(track.markers);
    if ('waveform' in track && !Array.isArray(track.waveform) && !(typeof track.waveform === 'string' && track.waveform)) {
        delete track.waveform;
    }
    return track as WaveformBarTrack;
}

/**
 * Merge fresh track data into an existing queue entry. Empty values (null,
 * undefined, '', []) never overwrite: a sparse source — an inline player with
 * no title, a trigger with no artwork — must not wipe what's already queued.
 * @param base
 * @param update
 * @returns 
 */
export function mergeTrack(base: WaveformBarTrack, update: Partial<WaveformBarTrack> | null | undefined): WaveformBarTrack {
    const merged = {...base};
    for (const [k, v] of Object.entries(update || {})) {
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
        merged[k] = v;
    }
    return merged;
}

/**
 * Parse track metadata from a trigger element
 * @param el
 * @returns 
 */
export function parseTrackFromElement(el: HTMLElement): WaveformBarTrack | null {
    const url = el.dataset.wbUrl || el.dataset.url;
    if (!url) return null;

    // Parse + shape-coerce. JSON.parse only validates the syntax — a value
    // like '"x"' or '[1,2]' parses cleanly but is the wrong shape and would
    // strand the bar downstream (e.g. `.map()` on a non-array). Coerce each
    // field to the shape the rest of the code expects.
    let meta: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(el.dataset.wbMeta || el.dataset.meta || '{}');
        meta = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {}

    let markers: WaveformBarMarker[] = [];
    try {
        markers = sanitizeMarkers(JSON.parse(el.dataset.wbMarkers || el.dataset.markers || 'null'));
    } catch (e) {}

    let waveform: number[] | null = null;
    try {
        const parsed = JSON.parse(el.dataset.wbWaveform || el.dataset.waveform || 'null');
        waveform = Array.isArray(parsed) ? parsed : null;
    } catch (e) {}

    return {
        url,
        id: el.dataset.wbId || el.dataset.id || url,
        title: el.dataset.wbTitle || el.dataset.title || extractTitle(url),
        artist: el.dataset.wbArtist || el.dataset.artist || '',
        artwork: el.dataset.wbArtwork || el.dataset.artwork || '',
        album: el.dataset.wbAlbum || el.dataset.album || '',
        link: el.dataset.wbLink || el.dataset.link || '',
        duration: el.dataset.wbDuration || el.dataset.duration || '',
        bpm: el.dataset.wbBpm || el.dataset.bpm || '',
        key: el.dataset.wbKey || el.dataset.key || '',
        waveform,
        markers,
        favorited: el.dataset.wbFavorited === 'true',
        inCart: el.dataset.wbInCart === 'true',
        meta
    };
}
