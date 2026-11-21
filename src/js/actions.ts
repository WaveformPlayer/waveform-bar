/**
 * @module actions
 * @description Action button handlers (favorite, cart) for WaveformBar
 */

import type {WaveformBarAction, WaveformBarActionPayload} from './types.js';

/**
 * Fire an action to an endpoint or callback
 * @param actionConfig - { endpoint, method, headers }
 * @param payload - Data to send
 */
export function fireAction(actionConfig: WaveformBarAction | null | undefined, payload: WaveformBarActionPayload): void {
    if (!actionConfig || !actionConfig.endpoint) return;

    // Callback function
    if (typeof actionConfig.endpoint === 'function') {
        try {
            actionConfig.endpoint(payload);
        } catch (err) {
            console.warn('[WaveformBar] Action callback error:', err);
        }
        return;
    }

    // REST endpoint
    if (typeof actionConfig.endpoint === 'string') {
        fetch(actionConfig.endpoint, {
            method: actionConfig.method || 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(actionConfig.headers || {})
            },
            body: JSON.stringify(payload)
        }).catch(err => console.warn('[WaveformBar] Action request failed:', err));
    }
}
