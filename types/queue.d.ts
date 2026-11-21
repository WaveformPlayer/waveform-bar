/**
 * @module queue
 * @description Queue panel rendering for WaveformBar
 */
import type { WaveformBarTrack } from './types.js';
/**
 * Create the queue panel DOM element
 */
export declare function createQueuePanel(): HTMLElement;
/**
 * Render queue panel contents
 * @param bodyEl - Queue body element
 * @param countEl - Queue count badge element
 * @param queue - Queue array
 * @param currentIndex - Current playing index
 * @param callbacks - { onSkipTo, onRemove }
 */
export declare function renderQueue(bodyEl: HTMLElement | null, countEl: HTMLElement | null, queue: WaveformBarTrack[], currentIndex: number, callbacks: {
    onSkipTo?: (index: number) => void;
    onRemove?: (index: number) => void;
}): void;
//# sourceMappingURL=queue.d.ts.map