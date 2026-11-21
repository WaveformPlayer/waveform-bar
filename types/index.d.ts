/**
 * WaveformBar
 * Persistent bottom audio player bar for WaveformPlayer
 *
 * @author ArrayPress
 * @license MIT
 */
import { WaveformBar } from './core.js';
import type { WaveformBarEventMap } from './types.js';
declare global {
    interface Window {
        /** The singleton, set when the bundle loads in a browser. */
        WaveformBar: WaveformBar;
    }
    interface DocumentEventMap extends WaveformBarEventMap {
    }
    interface HTMLElementEventMap extends WaveformBarEventMap {
    }
}
declare const instance: WaveformBar;
export default instance;
export { WaveformBar };
export type { WaveformBarRepeatMode, WaveformBarTheme, WaveformBarMode, WaveformBarMarker, WaveformBarTrack, WaveformBarActionPayload, WaveformBarAction, WaveformBarActions, WaveformBarConfig, WaveformBarEventMap, } from './types.js';
//# sourceMappingURL=index.d.ts.map