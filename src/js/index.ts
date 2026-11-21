/**
 * WaveformBar
 * Persistent bottom audio player bar for WaveformPlayer
 *
 * @author ArrayPress
 * @license MIT
 */

import {WaveformBar} from './core.js';
import type {WaveformBarEventMap} from './types.js';

declare global {
    interface Window {
        /** The singleton, set when the bundle loads in a browser. */
        WaveformBar: WaveformBar;
    }

    // The bar's events bubble from its element; listen on `document`.
    interface DocumentEventMap extends WaveformBarEventMap {}
    interface HTMLElementEventMap extends WaveformBarEventMap {}
}

// Create singleton instance
const instance = new WaveformBar();

// Browser global
if (typeof window !== 'undefined') {
    window.WaveformBar = instance;
}

export default instance;
export {WaveformBar};

// The public types (config, tracks, actions, events), for `import type { ... }`.
export type {
    WaveformBarRepeatMode,
    WaveformBarTheme,
    WaveformBarMode,
    WaveformBarMarker,
    WaveformBarTrack,
    WaveformBarActionPayload,
    WaveformBarAction,
    WaveformBarActions,
    WaveformBarConfig,
    WaveformBarEventMap,
} from './types.js';
