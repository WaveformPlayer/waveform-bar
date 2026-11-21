/**
 * @module storage
 * @description Persistence helpers for WaveformBar
 */
import type { WaveformBarQueueState } from './types.js';
/**
 * Save queue state to sessionStorage
 * @param key - Storage key
 * @param state - State to save
 */
export declare function saveQueueState(key: string, state: WaveformBarQueueState): void;
/**
 * Restore queue state from sessionStorage
 *
 * The stored value is only as trustworthy as the last thing that wrote it — a
 * different bar version's format, a half-written entry, or anything else sharing
 * the key. `d.queue.length` alone passes a plain string (`'abc'.length` is 3),
 * which then throws at the first `queue.findIndex()`, so the queue is
 * shape-checked as an array of tracks with URLs (each normalized, markers
 * included) before it's handed back. A restored state that isn't usable is
 * discarded rather than half-applied.
 *
 * @param key - Storage key
 */
export declare function restoreQueueState(key: string): WaveformBarQueueState | null;
/**
 * Save volume to localStorage (persists across sessions)
 * @param key - Storage key
 * @param volume
 * @param muted
 * @param volumeBeforeMute
 */
export declare function saveVolume(key: string, volume: number, muted: boolean, volumeBeforeMute: number): void;
/**
 * Restore volume from localStorage
 * @param key - Storage key
 * @returns { volume, muted, volumeBeforeMute }
 */
export declare function restoreVolume(key: string): {
    volume: number;
    muted: boolean;
    volumeBeforeMute: number;
} | null;
/**
 * Save favorites to localStorage
 * @param key - Storage key
 * @param favorites
 */
export declare function saveFavorites(key: string, favorites: Set<string>): void;
/**
 * Restore favorites from localStorage
 * @param key - Storage key
 */
export declare function restoreFavorites(key: string): Set<string>;
