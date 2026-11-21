/**
 * @module actions
 * @description Action button handlers (favorite, cart) for WaveformBar
 */
import type { WaveformBarAction, WaveformBarActionPayload } from './types.js';
/**
 * Fire an action to an endpoint or callback
 * @param actionConfig - { endpoint, method, headers }
 * @param payload - Data to send
 */
export declare function fireAction(actionConfig: WaveformBarAction | null | undefined, payload: WaveformBarActionPayload): void;
//# sourceMappingURL=actions.d.ts.map