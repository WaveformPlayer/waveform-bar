import { describe, it, expect } from 'vitest';
import WaveformPlayer from '@arraypress/waveform-player/no-autoinit';
import { parseTrackFromElement, parseDuration, formatTime, normalizeTrack, mergeTrack } from '../src/js/utils.js';

// 2.0: the bar's own isSafeHref copy is gone; the track-link and share-link
// guards call the core's `WaveformPlayer.utils.isSafeHref`, which every 2.0
// core has. The contract the bar relies on is still pinned here.
const { isSafeHref } = WaveformPlayer.utils;

describe('formatTime', () => {
	it('formats M:SS, staying in minutes past an hour', () => {
		expect(formatTime(0)).toBe('0:00');
		expect(formatTime(125)).toBe('2:05');
		expect(formatTime(3905)).toBe('65:05');
	});

	// A streamed / unseekable source reports `duration === Infinity`, which is
	// truthy and not NaN — so it slipped both guards and put a literal
	// 'Infinity:NaN' in the bar's time display.
	it('renders a non-finite duration as zero rather than "Infinity:NaN"', () => {
		expect(formatTime(Infinity)).toBe('0:00');
		expect(formatTime(-Infinity)).toBe('0:00');
		expect(formatTime(NaN)).toBe('0:00');
		expect(formatTime(-30)).toBe('0:00');
		expect(formatTime(undefined)).toBe('0:00');
		expect(formatTime('nonsense')).toBe('0:00');
	});
});

describe('isSafeHref', () => {
	it('allows http/https/relative, rejects script-bearing schemes', () => {
		expect(isSafeHref('https://x.com/a')).toBe(true);
		expect(isSafeHref('http://x.com')).toBe(true);
		expect(isSafeHref('/relative/path')).toBe(true);
		expect(isSafeHref('song.mp3')).toBe(true);
		expect(isSafeHref('javascript:alert(1)')).toBe(false);
		expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
		expect(isSafeHref('vbscript:msgbox')).toBe(false);
		expect(isSafeHref('')).toBe(false);
		expect(isSafeHref(null)).toBe(false);
		expect(isSafeHref(undefined)).toBe(false);
	});
});

describe('parseTrackFromElement shape coercion', () => {
	const mk = (data) => {
		const el = document.createElement('div');
		Object.assign(el.dataset, data);
		return el;
	};

	it('coerces wrong-shape-but-valid JSON for markers/meta/waveform without throwing', () => {
		const el = mk({
			wbUrl: 'a.mp3',
			wbMarkers: '"x"',     // valid JSON, not an array → []
			wbMeta: '[1,2]',      // valid JSON, array not object → {}
			wbWaveform: '"nope"', // valid JSON, not an array → null
		});
		let t;
		expect(() => { t = parseTrackFromElement(el); }).not.toThrow();
		expect(t.markers).toEqual([]);
		expect(t.meta).toEqual({});
		expect(t.waveform).toBe(null);
	});

	it('survives unparseable JSON in all three fields', () => {
		const el = mk({ wbUrl: 'a.mp3', wbMarkers: '{bad', wbMeta: '{bad', wbWaveform: '{bad' });
		const t = parseTrackFromElement(el);
		expect(t.markers).toEqual([]);
		expect(t.meta).toEqual({});
		expect(t.waveform).toBe(null);
	});

	it('coerces marker times to finite numbers and drops unusable entries', () => {
		const el = mk({
			wbUrl: 'a.mp3',
			wbMarkers: JSON.stringify([
				{ time: '30', label: 'A' },  // string time → 30
				{ time: 'bad', label: 'B' }, // NaN → dropped
				{ label: 'no-time' },        // missing time → dropped
				42,                          // non-object → dropped
				{ time: 90, label: 'C' },    // valid
			]),
		});
		const t = parseTrackFromElement(el);
		expect(t.markers).toEqual([
			{ time: 30, label: 'A' },
			{ time: 90, label: 'C' },
		]);
	});

	it('passes a valid waveform array and meta object through unchanged', () => {
		const el = mk({ wbUrl: 'a.mp3', wbWaveform: '[0.1,0.5,0.9]', wbMeta: '{"genre":"house"}' });
		const t = parseTrackFromElement(el);
		expect(t.waveform).toEqual([0.1, 0.5, 0.9]);
		expect(t.meta).toEqual({ genre: 'house' });
	});

	it('defaults to []/{} and null when the attributes are absent', () => {
		const el = mk({ wbUrl: 'a.mp3' });
		const t = parseTrackFromElement(el);
		expect(t.markers).toEqual([]);
		expect(t.meta).toEqual({});
		expect(t.waveform).toBe(null);
	});

	it('returns null when there is no url', () => {
		expect(parseTrackFromElement(mk({ wbTitle: 'No URL' }))).toBe(null);
	});

	// 2.0 cores decode compact peaks; JSON.parse rejected them, so a trigger's
	// wp1: peaks were silently dropped and the player decoded the audio.
	it('passes compact wp1: peaks through as the string, for the player to decode', () => {
		const peaks = WaveformPlayer.utils.encodeCompactPeaks([0, 0.5, 1]);
		expect(peaks.startsWith('wp1:')).toBe(true);
		expect(parseTrackFromElement(mk({ wbUrl: 'a.mp3', wbWaveform: peaks })).waveform).toBe(peaks);
		expect(parseTrackFromElement(mk({ url: 'a.mp3', waveform: peaks })).waveform).toBe(peaks);
		// Anything else that isn't JSON is still dropped.
		expect(parseTrackFromElement(mk({ wbUrl: 'a.mp3', wbWaveform: 'wp2:abc' })).waveform).toBe(null);
	});

	it('reads data-wb-duration / data-duration as given', () => {
		expect(parseTrackFromElement(mk({ wbUrl: 'a.mp3', wbDuration: '187' })).duration).toBe('187');
		expect(parseTrackFromElement(mk({ url: 'a.mp3', duration: '3:07' })).duration).toBe('3:07');
		expect(parseTrackFromElement(mk({ url: 'a.mp3' })).duration).toBe('');
	});
});

describe('parseDuration', () => {
	it('reads seconds, numeric strings and clock strings', () => {
		expect(parseDuration(187)).toBe(187);
		expect(parseDuration(187.5)).toBe(187.5);
		expect(parseDuration('187')).toBe(187);
		expect(parseDuration(' 187.5 ')).toBe(187.5);
		expect(parseDuration('3:07')).toBe(187);
		expect(parseDuration('0:45')).toBe(45);
		expect(parseDuration('1:02:03')).toBe(3723);
	});

	it('is undefined for anything that is not a length greater than 0', () => {
		for (const v of [undefined, null, '', 0, '0', '0:00', -5, '-5', NaN, Infinity, '3:7', '3:75', 'abc', '1e3', '3:07 min', [187], {}]) {
			expect(parseDuration(v), JSON.stringify(v)).toBe(undefined);
		}
	});
});

describe('normalizeTrack / mergeTrack', () => {
	it('keeps compact wp1: peaks (it validates nothing about a peaks string)', () => {
		expect(normalizeTrack({ url: 'a.mp3', waveform: 'wp1:AIA_' }).waveform).toBe('wp1:AIA_');
	});

	it('strips the player instance and null fields, keeps caller fields', () => {
		const t = normalizeTrack({ url: 'a.mp3', title: null, player: {}, price: 5, markers: 'x', waveform: null });
		expect(t).toEqual({ url: 'a.mp3', price: 5, markers: [] });
	});

	it('reads only track fields from a player request-play detail', () => {
		const t = normalizeTrack({ url: 'a.mp3', id: 'wp_abc', title: 'A', player: {}, artist: undefined }, { fromPlayer: true });
		expect(t).toEqual({ url: 'a.mp3', title: 'A' });
	});

	it('takes the known duration from a 2.0 player detail (null is skipped)', () => {
		expect(normalizeTrack({ url: 'a.mp3', duration: 187, player: {} }, { fromPlayer: true })).toEqual({ url: 'a.mp3', duration: 187 });
		expect(normalizeTrack({ url: 'a.mp3', duration: null, player: {} }, { fromPlayer: true })).toEqual({ url: 'a.mp3' });
	});

	it('rejects input with no usable url', () => {
		expect(normalizeTrack(null)).toBe(null);
		expect(normalizeTrack('a.mp3')).toBe(null);
		expect(normalizeTrack({ url: '' })).toBe(null);
	});

	it('merge never overwrites with empty values', () => {
		const merged = mergeTrack(
			{ url: 'a.mp3', title: 'Good', markers: [{ time: 1 }], artist: 'X' },
			{ url: 'a.mp3', title: null, markers: [], artist: '', artwork: 'c.jpg' }
		);
		expect(merged).toEqual({ url: 'a.mp3', title: 'Good', markers: [{ time: 1 }], artist: 'X', artwork: 'c.jpg' });
	});
});
