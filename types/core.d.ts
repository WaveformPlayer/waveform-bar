/**
 * @module core
 * @description Main WaveformBar class
 */
import type { WaveformPlayer } from '@arraypress/waveform-player';
import type { WaveformBarConfig, WaveformBarRepeatMode, WaveformBarTrack } from './types.js';
export declare class WaveformBar {
    queue: WaveformBarTrack[];
    currentIndex: number;
    isPlaying: boolean;
    isInitialized: boolean;
    queueOpen: boolean;
    isCollapsed: boolean;
    volume: number;
    isMuted: boolean;
    repeat: WaveformBarRepeatMode;
    shuffle: boolean;
    constructor();
    /**
     * Initialize WaveformBar
     * @param config
     */
    init(config?: WaveformBarConfig): this;
    /**
     * Destroy everything
     */
    destroy(): this;
    /**
     * Play a track immediately
     * @param trackOrUrl
     */
    play(trackOrUrl: WaveformBarTrack | string): this;
    /**
     * Add to end of queue
     * @param trackOrUrl
     */
    addToQueue(trackOrUrl: WaveformBarTrack | string): this;
    togglePlay(): this;
    pause(): this;
    next(): this;
    previous(): this;
    skipTo(index: number): this;
    /**
     * Seek to a specific marker by index on the current track
     * @param markerIndex
     */
    seekToMarker(markerIndex: number): this;
    /**
     * Seek to a marker by label on the current track
     * @param label
     */
    seekToMarkerByLabel(label: string): this;
    setVolume(level: number): this;
    getVolume(): number;
    toggleMute(): this;
    toggleFavorite(): this;
    addToCart(): this;
    isFavorited(id?: string | null): boolean;
    isInCart(id?: string | null): boolean;
    removeFromQueue(index: number): this;
    clearQueue(): this;
    getCurrentTrack(): WaveformBarTrack | null;
    getQueue(): WaveformBarTrack[];
    getCurrentIndex(): number;
    isCurrentlyPlaying(url: string): boolean | null;
    isCurrentTrack(url: string): boolean | null;
    getPlayer(): WaveformPlayer | null;
    show(): this;
    hide(): this;
    toggleQueuePanel(): this;
    openQueuePanel(): this;
    closeQueuePanel(): this;
    toggleVolumePopup(): this;
    openVolumePopup(): this;
    closeVolumePopup(): this;
    /**
     * Collapse the bar to a small floating pill (artwork + play + expand).
     */
    collapse(): this;
    /**
     * Restore the bar from its collapsed pill back to the full bar.
     */
    expand(): this;
    /**
     * Toggle the collapsed pill state.
     */
    toggleCollapse(): this;
    /**
     * Cycle through repeat modes: off → all → one → off
     */
    cycleRepeat(): this;
    /**
     * Set repeat mode directly
     * @param mode
     */
    setRepeat(mode: WaveformBarRepeatMode): this;
    /**
     * Toggle shuffle (random queue advance) on / off.
     */
    toggleShuffle(): this;
    /**
     * Set shuffle on / off directly.
     * @param on
     */
    setShuffle(on: boolean): this;
}
