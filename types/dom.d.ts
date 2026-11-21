/**
 * @module dom
 * @description DOM creation for WaveformBar
 */
import type { WaveformBarResolvedConfig } from './types.js';
/**
 * Build the bar's inner HTML based on config.
 *
 * Two layouts (`config.layout`):
 *  - `'default'` — transport + track on the left, waveform + time in the
 *    flexible centre, secondary controls on the right.
 *  - `'center'`  — Spotify-style 3 columns: now-playing on the left, the
 *    transport centred ABOVE a full-width seek row in the middle, and the
 *    secondary controls on the right.
 *
 * Both layouts emit the exact same elements / class names — only the
 * grouping + order differ — so `_createBar`'s class-based ref caching and
 * event binding work identically for either.
 *
 * @param config
 */
export declare function buildBarHTML(config: WaveformBarResolvedConfig): string;
