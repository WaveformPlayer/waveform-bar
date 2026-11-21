/**
 * @module queue
 * @description Queue panel rendering for WaveformBar
 */

import {ICONS} from './icons.js';
import {escapeHtml} from './utils.js';
import type {WaveformBarTrack} from './types.js';

/**
 * Create the queue panel DOM element
 */
export function createQueuePanel(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'wb-queue-panel';
    el.innerHTML = `
        <div class="wb-queue-header">
            <div class="wb-queue-title">
                ${ICONS.queue}
                Queue
                <span class="wb-queue-count">0</span>
            </div>
            <button class="wb-btn wb-btn-sm wb-queue-clear" aria-label="Clear queue">Clear</button>
        </div>
        <div class="wb-queue-body"></div>
    `;
    return el;
}

/**
 * One queue row. The number + title/artist sit in a real `<button>` so the
 * row is reachable and operable from the keyboard (it used to be a click-only
 * `<div>`); the remove button stays a sibling rather than nesting interactive
 * content inside it. Text uses block `<span>`s — `<div>` isn't allowed in a
 * button.
 * @param t - Track
 * @param index - Queue index
 * @param extraClass - Modifier class(es), with leading space
 * @param num - Number column content (index or icon markup)
 * @param removable - Render a remove button
 */
function queueItem(t: WaveformBarTrack, index: number, extraClass: string, num: string | number, removable: boolean): string {
    const current = extraClass.includes('wb-queue-current') ? ' aria-current="true"' : '';
    return `<div class="wb-queue-item${extraClass}" data-qi="${index}"${current}>
            <button type="button" class="wb-queue-skip">
                <span class="wb-queue-num">${num}</span>
                <span class="wb-queue-info">
                    <span class="wb-queue-item-title">${escapeHtml(t.title)}</span>
                    <span class="wb-queue-item-artist">${escapeHtml(t.artist)}</span>
                </span>
            </button>
            ${removable ? `<button type="button" class="wb-queue-remove" data-qi="${index}" aria-label="Remove">${ICONS.close}</button>` : ''}
        </div>`;
}

/**
 * Render queue panel contents
 * @param bodyEl - Queue body element
 * @param countEl - Queue count badge element
 * @param queue - Queue array
 * @param currentIndex - Current playing index
 * @param callbacks - { onSkipTo, onRemove }
 */
export function renderQueue(
    bodyEl: HTMLElement | null,
    countEl: HTMLElement | null,
    queue: WaveformBarTrack[],
    currentIndex: number,
    callbacks: {onSkipTo?: (index: number) => void; onRemove?: (index: number) => void}
): void {
    if (!bodyEl) return;

    const upcoming = Math.max(0, queue.length - 1 - currentIndex);
    if (countEl) countEl.textContent = upcoming as unknown as string;

    if (queue.length === 0) {
        bodyEl.innerHTML = `<div class="wb-queue-empty">${ICONS.queue}<p>Queue is empty</p></div>`;
        return;
    }

    // Re-rendering replaces the rows, which would drop keyboard focus to
    // <body> right after a keyboard skip/remove. Remember the focused row.
    const active = document.activeElement;
    const focusedQi = active && bodyEl.contains(active) ? active.closest<HTMLElement>('[data-qi]')?.dataset.qi : null;

    let html = '';

    // Now playing
    if (currentIndex >= 0 && currentIndex < queue.length) {
        html += '<div class="wb-queue-label">Now Playing</div>';
        html += queueItem(queue[currentIndex], currentIndex, ' wb-queue-current', ICONS.speaker, false);
    }

    // Next up
    let hasNext = false;
    for (let i = currentIndex + 1; i < queue.length; i++) {
        if (!hasNext) {
            html += '<div class="wb-queue-label">Next Up</div>';
            hasNext = true;
        }
        html += queueItem(queue[i], i, '', i - currentIndex, true);
    }

    // Previously played
    if (currentIndex > 0) {
        html += '<div class="wb-queue-label">Previously Played</div>';
        for (let j = currentIndex - 1; j >= 0; j--) {
            html += queueItem(queue[j], j, ' wb-queue-played', j + 1, false);
        }
    }

    bodyEl.innerHTML = html;

    // Bind click events
    bodyEl.querySelectorAll<HTMLElement>('.wb-queue-item[data-qi]').forEach(el => {
        el.addEventListener('click', (e) => {
            if ((e.target as Element).closest('.wb-queue-remove')) return;
            if (callbacks.onSkipTo) callbacks.onSkipTo(parseInt(el.dataset.qi!));
        });
    });

    bodyEl.querySelectorAll<HTMLElement>('.wb-queue-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (callbacks.onRemove) callbacks.onRemove(parseInt(btn.dataset.qi!));
        });
    });

    if (focusedQi != null) {
        const target = bodyEl.querySelector<HTMLElement>(`.wb-queue-item[data-qi="${focusedQi}"] .wb-queue-skip`)
            || bodyEl.querySelector<HTMLElement>('.wb-queue-skip');
        if (target) target.focus();
    }
}
