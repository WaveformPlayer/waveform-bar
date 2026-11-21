/**
 * @module core
 * @description Main WaveformBar class
 */

import {ICONS} from './icons.js';
import {
    extractTitle,
    escapeHtml,
    formatTime,
    parseTrackFromElement,
    isSafeHref,
    normalizeTrack,
    mergeTrack
} from './utils.js';
import {
    saveQueueState,
    restoreQueueState,
    saveVolume,
    restoreVolume,
    saveFavorites,
    restoreFavorites
} from './storage.js';
import {fireAction} from './actions.js';
import {buildBarHTML} from './dom.js';
import {createQueuePanel, renderQueue} from './queue.js';
import type {
    WaveformPlayer,
    WaveformLifecycleEventDetail,
    WaveformRequestEventDetail,
    WaveformRequestSeekEventDetail,
} from '@arraypress/waveform-player';
import type {
    WaveformBarConfig,
    WaveformBarMarker,
    WaveformBarRepeatMode,
    WaveformBarResolvedConfig,
    WaveformBarTheme,
    WaveformBarTrack,
} from './types.js';

/**
 * The embedded player as the bar uses it: it also reads the `<audio>` element,
 * which the player's published types leave out.
 */
type EmbeddedPlayer = WaveformPlayer & {audio: HTMLAudioElement | null};

/** A share link's target, parsed from the page URL by _readShareTarget(). */
interface ShareTarget {
    time: number;
    id: string | null;
    url: string | null;
    title: string | null;
    artist: string | null;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Default configuration
 */
const DEFAULTS = {
    persist: true,
    autoResume: true,
    continuous: true,
    repeat: 'off',          // 'off', 'all', 'one'
    shuffle: false,         // true = random queue advance (next / auto-advance pick a random track)
    showRepeat: true,
    showShuffle: false,     // show a shuffle toggle button in the transport cluster
    showQueue: true,
    showPrevNext: true,
    showVolume: true,
    showMute: true,
    showMeta: true,
    showTime: true,
    showTrackLink: true,
    maxMeta: 3,
    defaultArtwork: null,   // URL to fallback artwork image
    theme: null,            // 'dark', 'light', or null (dark by default)
    wide: false,            // two sizes — false = default (1400px cap), true = full width. Applies to waveform mode only.
    position: 'bottom',     // 'bottom' (default) or 'top' — which edge the bar docks to
    collapsible: false,     // show a collapse button that shrinks the bar to a floating transport pill
    // mode: 'waveform' (default layout + waveform, width-adjustable) | 'classic'
    // (Spotify-style centre layout + seekbar, full-width). NOT defaulted here —
    // its default is inferred from `waveform`/`layout` in init() so the legacy
    // options still work; see the derivation there.
    waveform: true,         // internal seek style; classic mode forces seekbar
    errorText: null,        // custom "audio failed to load" message (null = player default)
    crossOrigin: null,      // CORS mode for the embedded <audio> ('anonymous' | 'use-credentials' | null). null = don't set it (native <audio> behavior; avoids breaking CDN media without CORS headers). Forwarded to the player. See waveform-player issue #18.
    // Localizable UI strings forwarded to the embedded player (null = player
    // default). seekValueText templates the seek slider's spoken aria-valuetext
    // (%1$s current, %2$s total); unknownTrackText is its Media Session title
    // fallback. playPauseLabel/speedLabel/artworkAlt are accepted for
    // completeness but govern player controls/info the bar hides.
    seekValueText: null,
    playPauseLabel: null,
    speedLabel: null,
    artworkAlt: null,
    unknownTrackText: null,
    share: false,           // show a "copy share link" button (emits ?<shareParam>=<seconds>)
    shareParam: 'wt',       // URL query param for the shared timestamp (seconds)
    waveformStyle: 'mirror',
    waveformHeight: 32,
    barWidth: 2,
    barSpacing: 2,        // 2px gap between 2px bars — crisp, separated bars (0 = solid "blob")
    barRadius: null,      // rounded bar caps in px (0 = square). null = player default (waveform-player 1.8.0+)
    waveformColor: null,
    progressColor: null,
    waveformGradient: 'vertical',
    markerColor: 'rgba(255, 255, 255, 0.25)',
    volume: 1,
    storageKey: 'waveform-bar',
    actions: null,
    onPlay: null,
    onPause: null,
    onTrackChange: null,
    onQueueChange: null,
    onVolumeChange: null,
    onShuffleChange: null,
    onFavorite: null,
    onCart: null
} satisfies WaveformBarConfig;

/**
 * Resolve a public-API track argument (object or bare URL) to a normalized
 * queue entry, or null when it has no usable url.
 * @param trackOrUrl
 */
function toTrack(trackOrUrl: WaveformBarTrack | string): WaveformBarTrack | null {
    return typeof trackOrUrl === 'string'
        ? normalizeTrack({url: trackOrUrl, id: trackOrUrl, title: extractTitle(trackOrUrl)})
        : normalizeTrack(trackOrUrl);
}

export class WaveformBar {
    // Public state. `declare` emits nothing: every field is assigned in the
    // constructor (or later) exactly as in 1.x.
    declare queue: WaveformBarTrack[];
    declare currentIndex: number;
    declare isPlaying: boolean;
    declare isInitialized: boolean;
    declare queueOpen: boolean;
    declare isCollapsed: boolean;
    declare volume: number;
    declare isMuted: boolean;
    declare repeat: WaveformBarRepeatMode;
    declare shuffle: boolean;

    /**
     * @internal The merged config. It is null before init() and after
     * destroy(), but typed non-null: everything that reads it runs after init().
     */
    declare config: WaveformBarResolvedConfig;
    /** @internal The embedded player. Public as getPlayer(). */
    declare player: EmbeddedPlayer | null;

    /** @internal */ declare _volumeBeforeMute: number;
    /** @internal */ declare _lastPosition: number;
    /** @internal */ declare _lastSaveTime: number;
    /** @internal */ declare _favorites: Set<string>;
    /** @internal */ declare _cartItems: Set<string>;
    /** @internal */ declare _observer: MutationObserver | null;
    /** @internal */ declare _observeTimeout: Timer | null | undefined;
    /** @internal */ declare _activeMarkers: WaveformBarMarker[] | null;
    /** @internal */ declare _currentMarkerIndex: number;
    /** @internal */ declare _shufflePlayed: Set<string>;
    /** @internal */ declare _loadSeq: number;
    /** @internal */ declare _restoreSeekTimeout: Timer | null;
    /** @internal */ declare _shareFlashTimeout: Timer | null | undefined;
    /** @internal */ declare _externalPlayers: Map<string, Set<WaveformPlayer>>;
    /** @internal */ declare _externalListenersBound: boolean;
    /** @internal */ declare _onExtRequestPlay: ((e: CustomEvent<WaveformRequestEventDetail>) => void) | null;
    /** @internal */ declare _onExtRequestPause: ((e: CustomEvent<WaveformRequestEventDetail>) => void) | null;
    /** @internal */ declare _onExtRequestSeek: ((e: CustomEvent<WaveformRequestSeekEventDetail>) => void) | null;
    /** @internal */ declare _onExtDestroy: ((e: CustomEvent<WaveformLifecycleEventDetail>) => void) | null;
    /** @internal */ declare _shareTarget: ShareTarget | null;
    /** @internal */ declare _shareSeek: number | null;
    /** @internal */ declare _resolvedTheme: WaveformBarTheme;
    /** @internal */ declare _beforeUnloadHandler: (() => void) | null;
    /** @internal */ declare _visibilityHandler: (() => void) | null;
    /** @internal */ declare _themeObserver: MutationObserver | null;
    /** @internal */ declare _themeMq: MediaQueryList | null;
    /** @internal */ declare _themeMqHandler: (() => void) | null;
    /** @internal */ declare _barHeightObserver: ResizeObserver | null;
    /** @internal */ declare _docClickVolume: ((e: MouseEvent) => void) | null;
    /** @internal */ declare _docClickQueue: ((e: MouseEvent) => void) | null;
    /** @internal */ declare _docKeydownQueue: ((e: KeyboardEvent) => void) | null;
    /** @internal */ declare _docClickTriggers: ((e: MouseEvent) => void) | null;

    // DOM refs
    /** @internal */ declare barEl: HTMLElement | null;
    /** @internal */ declare queueEl: HTMLElement | null;
    /** @internal */ declare waveformContainer: HTMLElement | null;
    /** @internal */ declare volumePopupEl: HTMLElement | null;
    /** @internal */ declare titleEl: HTMLElement | null;
    /** @internal */ declare artistEl: HTMLElement | null;
    /** @internal */ declare metaEl: HTMLElement | null;
    /** @internal */ declare playBtnEl: HTMLElement | null;
    /** @internal */ declare repeatBtnEl: HTMLElement | null;
    /** @internal */ declare shuffleBtnEl: HTMLElement | null;
    /** @internal */ declare shareBtnEl: HTMLElement | null;
    /** @internal */ declare collapseBtnEl: HTMLElement | null;
    /** @internal */ declare queueBtnEl: HTMLElement | null;
    /** @internal */ declare queueBodyEl: HTMLElement | null;
    /** @internal */ declare queueCountEl: HTMLElement | null;
    /** @internal */ declare volumeSliderEl: HTMLInputElement | null;
    /** @internal */ declare muteBtnEl: HTMLElement | null;
    /** @internal */ declare favBtnEl: HTMLElement | null;
    /** @internal */ declare cartBtnEl: HTMLElement | null;
    /** @internal */ declare timeCurrentEl: HTMLElement | null;
    /** @internal */ declare timeTotalEl: HTMLElement | null;

    constructor() {
        this.config = null!;
        this.player = null;
        this.queue = [];
        this.currentIndex = -1;
        this.isPlaying = false;
        this.isInitialized = false;
        this.queueOpen = false;
        this.volume = 1;
        this.isMuted = false;
        this._volumeBeforeMute = 1;
        this._lastPosition = 0;
        this._favorites = new Set();
        this._cartItems = new Set();
        this._observer = null;
        this._activeMarkers = null;
        this._currentMarkerIndex = -1;
        this.repeat = 'off'; // 'off', 'all', 'one'
        this.shuffle = false;
        // URLs already played in the current shuffle pass — shuffle picks
        // only from the rest, and the pass ends (or restarts under
        // repeat 'all') once every track has had its turn.
        this._shufflePlayed = new Set();

        // Load-race guard: bumped before every track load so async
        // continuations (loadTrack().then / restore-seek timeout) can detect
        // that a newer load superseded them and bail out.
        this._loadSeq = 0;
        this._restoreSeekTimeout = null;

        // Map<url, Set<WaveformPlayer>> of external-mode visual surfaces.
        this._externalPlayers = new Map();

        // DOM refs
        this.barEl = null;
        this.queueEl = null;
        this.waveformContainer = null;
        this.volumePopupEl = null;
        this.titleEl = null;
        this.artistEl = null;
        this.metaEl = null;
        this.playBtnEl = null;
        this.repeatBtnEl = null;
        this.shuffleBtnEl = null;
        this.queueBtnEl = null;
        this.queueBodyEl = null;
        this.queueCountEl = null;
        this.volumeSliderEl = null;
        this.muteBtnEl = null;
        this.favBtnEl = null;
        this.cartBtnEl = null;
        this.timeCurrentEl = null;
        this.timeTotalEl = null;
    }

    // =====================================================================
    // Init / Destroy
    // =====================================================================

    /**
     * Initialize WaveformBar
     * @param config
     */
    init(config: WaveformBarConfig = {}): WaveformBar {
        if (this.isInitialized) this.destroy();

        // `mode` and `layout` are derived just below.
        this.config = {...DEFAULTS, ...config} as WaveformBarResolvedConfig;

        // Normalize volume from config — guard NaN / out-of-range so a bad
        // value can't mute the player or throw downstream.
        const v = Number(this.config.volume);
        this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;

        // Mode is the canonical switch: 'waveform' (default layout + waveform
        // viz) or 'classic' (Spotify-style centre layout + seekbar). It's
        // inferred from the legacy `waveform`/`layout` options when not given,
        // and in turn SETS them, so the rest of the code keeps reading
        // config.layout / config.waveform unchanged.
        let mode = this.config.mode;
        if (mode !== 'classic' && mode !== 'waveform') {
            mode = (this.config.layout === 'center' || this.config.waveform === false) ? 'classic' : 'waveform';
        }
        this.config.mode = mode;
        this.config.layout = mode === 'classic' ? 'center' : 'default';
        this.config.waveform = mode !== 'classic';

        // Shareable timestamp: parse the share link's `?<shareParam>=<seconds>`
        // (time) plus the track identity (`?wid` = id, `?wu` = url fallback,
        // `?wtitle`/`?wartist` for display). When the link names a track we
        // cold-load it below; a bare `?<shareParam>=` with no track just seeks
        // whatever loads first (applied once in the player onLoad hook).
        this._shareTarget = this._readShareTarget();
        this._shareSeek = (this._shareTarget && !this._shareTarget.id && !this._shareTarget.url)
            ? this._shareTarget.time
            : null;

        if (typeof window.WaveformPlayer === 'undefined') {
            console.error('[WaveformBar] WaveformPlayer is required.');
            return this;
        }

        this._createBar();
        this._createQueue();
        this._initPlayer();
        this._bindTriggers();
        this._observeDOM();
        this._watchTheme();

        if (this.config.persist) {
            this._restoreVolume();
            this._restoreFavorites();
        }

        // Seed favorites/cart from data attributes on page elements
        // This is authoritative — overrides localStorage if present
        this._seedFromAttributes();

        if (this.config.persist) {
            this._restoreState();
        }

        // A share link that names a track (`?wid`/`?wu`) cold-loads it here —
        // AFTER restore, so the shared track wins over the visitor's own last
        // session. It loads paused at the shared timestamp (autoplay is blocked
        // on a cold page open anyway, and landing cued is the right UX).
        if (this._shareTarget && (this._shareTarget.id || this._shareTarget.url)) {
            const shared = normalizeTrack(this._resolveSharedTrack(this._shareTarget));
            if (shared) this._loadSharedTrack(shared, this._shareTarget.time);
        }

        this.isInitialized = true;

        // Save exact position when navigating away. beforeunload alone isn't
        // enough: iOS Safari doesn't reliably fire it (and it blocks the
        // bfcache), so also save on pagehide and whenever the page is hidden
        // — the last moment a mobile tab is guaranteed to run script.
        this._beforeUnloadHandler = () => this._saveState();
        this._visibilityHandler = () => {
            if (document.visibilityState === 'hidden') this._saveState();
        };
        window.addEventListener('beforeunload', this._beforeUnloadHandler);
        window.addEventListener('pagehide', this._beforeUnloadHandler);
        document.addEventListener('visibilitychange', this._visibilityHandler);

        return this;
    }

    /**
     * Destroy everything
     */
    destroy(): WaveformBar {
        // Flip every inline external player to paused before the map is
        // dropped below. The embedded player's teardown doesn't route back
        // through onPause, so without this they'd stay "playing" (and keep
        // their animation loop running) with nothing left to stop them.
        this._pumpExternalPlayState(false);

        if (this.player) {
            this.player.destroy();
            this.player = null;
        }
        if (this._themeObserver) {
            this._themeObserver.disconnect();
            this._themeObserver = null;
        }
        if (this._themeMq && this._themeMqHandler) {
            this._themeMq.removeEventListener('change', this._themeMqHandler);
            this._themeMq = null;
            this._themeMqHandler = null;
        }
        if (this._docClickVolume) {
            document.removeEventListener('click', this._docClickVolume);
            this._docClickVolume = null;
        }
        if (this._docClickQueue) {
            document.removeEventListener('click', this._docClickQueue);
            this._docClickQueue = null;
        }
        if (this._docKeydownQueue) {
            document.removeEventListener('keydown', this._docKeydownQueue);
            this._docKeydownQueue = null;
        }
        // Single delegated trigger listener (replaces per-element binding).
        if (this._docClickTriggers) {
            document.removeEventListener('click', this._docClickTriggers);
            this._docClickTriggers = null;
        }
        // External-mode WaveformPlayer document listeners — previously
        // anonymous and never removed. Stored on `this` so they can be torn
        // down and the bind flag reset for a clean re-init.
        if (this._externalListenersBound) {
            document.removeEventListener('waveformplayer:request-play', this._onExtRequestPlay as EventListener);
            document.removeEventListener('waveformplayer:request-pause', this._onExtRequestPause as EventListener);
            document.removeEventListener('waveformplayer:request-seek', this._onExtRequestSeek as EventListener);
            document.removeEventListener('waveformplayer:destroy', this._onExtDestroy as EventListener);
            this._onExtRequestPlay = null;
            this._onExtRequestPause = null;
            this._onExtRequestSeek = null;
            this._onExtDestroy = null;
            this._externalListenersBound = false;
        }
        this._externalPlayers = new Map();

        // Cancel pending async work that could touch torn-down refs.
        if (this._restoreSeekTimeout) {
            clearTimeout(this._restoreSeekTimeout);
            this._restoreSeekTimeout = null;
        }
        clearTimeout(this._shareFlashTimeout as Timer | undefined);
        this._shareFlashTimeout = null;
        // Invalidate any in-flight load continuation.
        this._loadSeq++;

        if (this.barEl) {
            this.barEl.remove();
            this.barEl = null;
        }
        if (this.queueEl) {
            this.queueEl.remove();
            this.queueEl = null;
        }
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        clearTimeout(this._observeTimeout as Timer | undefined);
        this._observeTimeout = null;
        if (this._barHeightObserver) {
            this._barHeightObserver.disconnect();
            this._barHeightObserver = null;
        }
        if (this._beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this._beforeUnloadHandler);
            window.removeEventListener('pagehide', this._beforeUnloadHandler);
            this._beforeUnloadHandler = null;
        }
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }

        // Null cached DOM refs so a stale ref can't be poked after teardown.
        this.volumePopupEl = null;
        this.queueBtnEl = null;
        this.titleEl = null;
        this.artistEl = null;
        this.metaEl = null;
        this.playBtnEl = null;
        this.repeatBtnEl = null;
        this.shuffleBtnEl = null;
        this.waveformContainer = null;
        this.queueBodyEl = null;
        this.queueCountEl = null;
        this.muteBtnEl = null;
        this.volumeSliderEl = null;
        this.favBtnEl = null;
        this.cartBtnEl = null;
        this.timeCurrentEl = null;
        this.timeTotalEl = null;

        document.querySelectorAll('.wb-current,.wb-playing').forEach(el => el.classList.remove('wb-current', 'wb-playing'));

        this.queue = [];
        this.currentIndex = -1;
        this.isPlaying = false;
        this.queueOpen = false;
        this.isCollapsed = false;
        // Session state that init() only overwrites when persistence restores
        // it — reset here so a re-init with different config starts clean.
        this.isMuted = false;
        this._volumeBeforeMute = 1;
        this._favorites = new Set();
        this._cartItems = new Set();
        this._lastPosition = 0;
        this._lastSaveTime = 0;
        this._activeMarkers = null;
        this._currentMarkerIndex = -1;
        this._shufflePlayed = new Set();
        this.isInitialized = false;
        this.config = null!;
        return this;
    }

    // =====================================================================
    // DOM Setup (private)
    // =====================================================================

    /** @internal */
    _createBar() {
        this.barEl = document.createElement('div');
        this.barEl.className = 'waveform-bar';
        // Hidden until show(). The idle bar is only slid off-screen and faded,
        // so without `inert` its controls stay in the tab order while invisible.
        // show()/hide() toggle it in lockstep with `.wb-active`.
        this.barEl.setAttribute('inert', '');

        // Theme: explicit or auto-detect
        const theme = this.config.theme || this._detectTheme();
        if (theme === 'light') this.barEl.classList.add('wb-light');
        this._resolvedTheme = theme;

        // Width: two sizes — default (the stylesheet's 1400px cap) or `wide`
        // (full width). Waveform mode only; classic is always full-width.
        if (this.config.mode === 'waveform' && this.config.wide) {
            this.barEl.style.setProperty('--wb-max-width', '100%');
        }

        // Dock to the top edge instead of the bottom (flips slide direction).
        if (this.config.position === 'top') this.barEl.classList.add('wb-top');

        // Centered 3-column layout (transport centred above the seek row).
        if (this.config.layout === 'center') this.barEl.classList.add('wb-layout-center');

        this.barEl.id = 'waveform-bar';
        this.barEl.innerHTML = buildBarHTML(this.config);
        document.body.appendChild(this.barEl);

        // Cache refs
        this.titleEl = this.barEl.querySelector<HTMLElement>('.wb-title');
        this.artistEl = this.barEl.querySelector<HTMLElement>('.wb-artist');
        this.metaEl = this.barEl.querySelector<HTMLElement>('.wb-meta');
        this.playBtnEl = this.barEl.querySelector<HTMLElement>('.wb-play');
        this.waveformContainer = this.barEl.querySelector<HTMLElement>('.wb-waveform-container');
        this.queueBtnEl = this.barEl.querySelector<HTMLElement>('.wb-queue-btn');
        this.shareBtnEl = this.barEl.querySelector<HTMLElement>('.wb-share');
        this.muteBtnEl = this.barEl.querySelector<HTMLElement>('.wb-mute');
        this.volumeSliderEl = this.barEl.querySelector<HTMLInputElement>('.wb-volume-slider');
        this.favBtnEl = this.barEl.querySelector<HTMLElement>('.wb-fav');
        this.cartBtnEl = this.barEl.querySelector<HTMLElement>('.wb-cart');
        this.timeCurrentEl = this.barEl.querySelector<HTMLElement>('.wb-time-current');
        this.timeTotalEl = this.barEl.querySelector<HTMLElement>('.wb-time-total');
        this.collapseBtnEl = this.barEl.querySelector<HTMLElement>('.wb-collapse');

        // Bind controls
        this.playBtnEl!.addEventListener('click', () => this.togglePlay());

        // Collapse-to-pill toggle.
        if (this.collapseBtnEl) {
            this.collapseBtnEl.addEventListener('click', () => this.toggleCollapse());
            if (this._readCollapsed()) this.collapse();
        }

        const prevBtn = this.barEl.querySelector('.wb-prev');
        const nextBtn = this.barEl.querySelector('.wb-next');
        if (prevBtn) prevBtn.addEventListener('click', () => this.previous());
        if (nextBtn) nextBtn.addEventListener('click', () => this.next());
        if (this.shareBtnEl) this.shareBtnEl.addEventListener('click', () => this._share());

        // Seed repeat from config regardless of whether the button is shown
        // (same as shuffle below), so `{ repeat: 'all', showRepeat: false }`
        // still loops. Unknown values fall back to 'off'.
        this.repeat = ['off', 'all', 'one'].includes(this.config.repeat) ? this.config.repeat : 'off';
        this.repeatBtnEl = this.barEl.querySelector<HTMLElement>('.wb-repeat');
        if (this.repeatBtnEl) {
            this._updateRepeatButton();
            this.repeatBtnEl.addEventListener('click', () => this.cycleRepeat());
        }

        // Seed shuffle from config regardless of whether the toggle button is
        // shown, so `{ shuffle: true, showShuffle: false }` still randomises advance.
        this.shuffle = !!this.config.shuffle;
        this.shuffleBtnEl = this.barEl.querySelector<HTMLElement>('.wb-shuffle');
        if (this.shuffleBtnEl) {
            this._updateShuffleButton();
            this.shuffleBtnEl.addEventListener('click', () => this.toggleShuffle());
        }

        if (this.queueBtnEl) this.queueBtnEl.addEventListener('click', () => this.toggleQueuePanel());

        // Volume: click mutes, hover shows popup
        this.volumePopupEl = this.barEl.querySelector<HTMLElement>('.wb-volume-popup');
        const volumeWrapper = this.barEl.querySelector('.wb-volume');

        if (this.muteBtnEl) {
            this.muteBtnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMute();
            });
        }

        if (volumeWrapper && this.volumePopupEl) {
            let hoverTimeout: Timer | undefined;
            volumeWrapper.addEventListener('mouseenter', () => {
                clearTimeout(hoverTimeout);
                this.openVolumePopup();
            });
            volumeWrapper.addEventListener('mouseleave', () => {
                hoverTimeout = setTimeout(() => this.closeVolumePopup(), 300);
            });
        }

        if (this.volumeSliderEl) {
            this.volumeSliderEl.addEventListener('input', (e) => {
                e.stopPropagation();
                this.setVolume(parseInt((e.target as HTMLInputElement).value) / 100);
            });
        }

        // Close volume popup on outside click.
        // Stored on `this` so destroy() can remove it — otherwise every
        // re-init (init() calls destroy() first) leaks another listener.
        this._docClickVolume = (e) => {
            if (this.volumePopupEl?.classList.contains('wb-volume-open') &&
                !this.barEl?.querySelector('.wb-volume')?.contains(e.target as Node | null)) {
                this.closeVolumePopup();
            }
        };
        document.addEventListener('click', this._docClickVolume);

        if (this.favBtnEl) this.favBtnEl.addEventListener('click', () => this.toggleFavorite());
        if (this.cartBtnEl) this.cartBtnEl.addEventListener('click', () => this.addToCart());

        // Track link
        if (this.config.showTrackLink) {
            this.barEl.querySelector('.wb-track')!.addEventListener('click', () => {
                const t = this.getCurrentTrack();
                // Guard the scheme — a `data-wb-link="javascript:…"` value
                // would otherwise execute on navigation (open-redirect / XSS).
                if (t && t.link && isSafeHref(t.link)) window.location.href = t.link;
            });
        }
    }

    /** @internal */
    _createQueue() {
        if (!this.config.showQueue) return;

        this.queueEl = createQueuePanel();
        if (this._resolvedTheme === 'light') this.queueEl.classList.add('wb-light');
        document.body.appendChild(this.queueEl);

        // Publish the bar's height as --wb-height on the queue so it can sit
        // flush on top of the bar (a full-width sheet on mobile). Re-measured on
        // any bar resize — layout change, artwork size, window resize.
        if (typeof ResizeObserver !== 'undefined' && this.barEl) {
            const syncBarHeight = () => {
                if (this.queueEl && this.barEl) this.queueEl.style.setProperty('--wb-height', this.barEl.offsetHeight + 'px');
            };
            syncBarHeight();
            this._barHeightObserver = new ResizeObserver(syncBarHeight);
            this._barHeightObserver.observe(this.barEl);
        }

        this.queueBodyEl = this.queueEl.querySelector<HTMLElement>('.wb-queue-body');
        this.queueCountEl = this.queueEl.querySelector<HTMLElement>('.wb-queue-count');

        this.queueEl.querySelector('.wb-queue-clear')!.addEventListener('click', () => this.clearQueue());

        // Stored on `this` so destroy() can remove it — otherwise every
        // re-init leaks another document listener.
        this._docClickQueue = (e) => {
            if (this.queueOpen && !this.queueEl?.contains(e.target as Node | null) && !this.queueBtnEl?.contains(e.target as Node | null)) {
                this.closeQueuePanel();
            }
        };
        document.addEventListener('click', this._docClickQueue);

        // Escape closes the queue panel and returns focus to its trigger.
        this._docKeydownQueue = (e) => {
            if (e.key === 'Escape' && this.queueOpen) {
                this.closeQueuePanel();
                this.queueBtnEl?.focus();
            }
        };
        document.addEventListener('keydown', this._docKeydownQueue);
    }

    /** @internal */
    _initPlayer() {
        // Typed loosely: the bar forwards `null` for "the player's default".
        const opts: Record<string, any> = {
            showControls: false,
            showInfo: false,
            // Classic mode reuses the player's own built-in 'seekbar' style —
            // a simple rounded progress bar (no waveform), with the player's
            // native click-to-seek. No custom seek-bar DOM needed.
            waveformStyle: this.config.waveform === false ? 'seekbar' : this.config.waveformStyle,
            // Slim host for the classic seekbar so it doesn't inflate the bar.
            // 20px gives a comfortable drag hit-area; the visual `.wb-seek` row
            // is held to ~16px and the host overflows it a touch. The waveform
            // keeps its configured height.
            height: this.config.waveform === false ? 20 : this.config.waveformHeight,
            barWidth: this.config.barWidth,
            barSpacing: this.config.barSpacing,
            errorText: this.config.errorText,   // null -> player uses its own default
            // Localizable UI strings — forwarded verbatim (null -> player default).
            // Only seekValueText (the bar's visible seek slider) and
            // unknownTrackText (the embedded self-mode player's Media Session
            // title fallback) have an effect here; the bar hides the player's
            // own controls/info, so playPauseLabel/speedLabel/artworkAlt are
            // passed through for completeness but govern hidden UI.
            seekValueText: this.config.seekValueText,
            playPauseLabel: this.config.playPauseLabel,
            speedLabel: this.config.speedLabel,
            artworkAlt: this.config.artworkAlt,
            unknownTrackText: this.config.unknownTrackText,
            singlePlay: false,
            // Time tooltip + draggable seek handle (the compact-transport seek
            // affordances) — on for the bar, off by default for standalone players.
            showHoverTime: true,
            seekHandle: true,
            onPlay: () => {
                this.isPlaying = true;
                this._updatePlayButton();
                this._syncPageState();
                this._pumpExternalPlayState(true);
                const track = this.getCurrentTrack();
                this._emit('play', {track});
                if (this.config.onPlay) this.config.onPlay(track);
            },
            onPause: () => {
                this.isPlaying = false;
                this._updatePlayButton();
                this._syncPageState();
                this._pumpExternalPlayState(false);
                this._saveState();
                const track = this.getCurrentTrack();
                this._emit('pause', {track});
                if (this.config.onPause) this.config.onPause(track);
            },
            onEnd: () => {
                this.isPlaying = false;
                this._updatePlayButton();
                this._syncPageState();
                this._pumpExternalPlayState(false);

                // Reset time display
                if (this.timeCurrentEl) this.timeCurrentEl.textContent = '0:00';

                // Handle repeat modes
                if (this.repeat === 'one') {
                    // Repeat current track
                    if (this.player) {
                        this.player.seekTo(0);
                        this._playSafely();
                    }
                    return;
                }

                if (this.shuffle && this.config.continuous && this.queue.length > 1) {
                    // Shuffle: jump to a random track not yet played this
                    // pass; stop once they all have (unless repeat 'all').
                    const i = this._nextShuffleIndex();
                    if (i >= 0) {
                        this.currentIndex = i;
                        this._loadCurrentTrack();
                    }
                    return;
                }

                if (this.config.continuous && this.currentIndex < this.queue.length - 1) {
                    // Next track
                    this.currentIndex++;
                    this._loadCurrentTrack();
                } else if (this.repeat === 'all' && this.queue.length > 0) {
                    // Loop back to start (or a random track when shuffling).
                    this.currentIndex = this.shuffle && this.queue.length > 1 ? this._nextShuffleIndex() : 0;
                    this._loadCurrentTrack();
                }
            },
            onError: () => {
                // A track failed to load/decode (bad URL, 404, codec). Without
                // this the queue dead-stops on the broken entry. Reset play
                // state, notify, and — when continuous — skip to the next
                // entry so one dead track doesn't halt the whole queue.
                this.isPlaying = false;
                this._updatePlayButton();
                this._syncPageState();
                this._pumpExternalPlayState(false);

                const track = this.getCurrentTrack();
                this._emit('error', {track});

                // Error recovery: advance strictly sequentially, regardless of
                // shuffle, and never wrap via repeat-all — a random/looping pick
                // among dead tracks risks re-selecting broken entries forever.
                if (this.config.continuous && this.currentIndex < this.queue.length - 1) {
                    this.currentIndex++;
                    this._loadCurrentTrack();
                }
            },
            onTimeUpdate: (currentTime: number, duration: number) => {
                this._lastPosition = currentTime;
                if (this.timeCurrentEl) this.timeCurrentEl.textContent = formatTime(currentTime);
                if (this.timeTotalEl) this.timeTotalEl.textContent = formatTime(duration);

                // Mirror progress into any external-mode WaveformPlayer
                // instances tracking this URL — their canvases scrub in
                // sync with the bar's audio.
                this._pumpExternalProgress(currentTime, duration);

                // Save state periodically during playback. Math.abs so a
                // backwards seek (currentTime now well below the last save)
                // saves too, instead of waiting to climb past it again.
                if (!this._lastSaveTime || Math.abs(currentTime - this._lastSaveTime) > 2) {
                    this._lastSaveTime = currentTime;
                    this._saveState();
                }

                // DJ mode: update title/artist when crossing marker boundaries
                if (this._activeMarkers) {
                    this._checkMarkerBoundary(currentTime);
                }
            },
            onLoad: () => {
                // Apply a shareable-timestamp seek (?<shareParam>=) once, on the
                // first track load after a fresh page open.
                if (this._shareSeek != null && this.player) {
                    this.player.seekTo(this._shareSeek);
                    this._shareSeek = null;
                }
            }
        };

        if (this.config.waveformColor) opts.waveformColor = this.config.waveformColor;
        if (this.config.progressColor) opts.progressColor = this.config.progressColor;
        if (this.config.waveformGradient) opts.waveformGradient = this.config.waveformGradient;
        if (this.config.crossOrigin) opts.crossOrigin = this.config.crossOrigin;
        // `!= null`, not truthiness: 0 (square caps) is a meaningful value.
        if (this.config.barRadius != null) opts.barRadius = this.config.barRadius;

        // Lock-screen / Media Session skip-track buttons drive the bar's queue.
        opts.onNextTrack = () => this.next();
        opts.onPreviousTrack = () => this.previous();

        this.player = new window.WaveformPlayer(this.waveformContainer!, opts) as EmbeddedPlayer;
        this.player.setVolume(this.volume);
    }

    // =====================================================================
    // Triggers (private)
    // =====================================================================

    /** @internal */
    _bindTriggers() {
        // ONE delegated document listener instead of per-element binding.
        // Per-element listeners leaked on every re-init (init() → destroy()
        // only cleared a flag, never removed the handlers), leaving each row
        // with stacked handlers that toggled each other so clicks did nothing.
        // Delegation also covers late-mounted triggers for free, so the
        // MutationObserver no longer needs to re-bind anything.
        if (!this._docClickTriggers) {
            this._docClickTriggers = (e) => {
                // Clicks inside an external-mode inline player belong to that
                // player: its play button / canvas already dispatched a
                // request-play/-pause/-seek carrying the real intent. On the
                // documented "trigger + inline surface" element the bubbled
                // click would otherwise reach [data-wb-play] too, call play()
                // on the now-current URL and toggle it straight back off (and
                // a seek-click would pause).
                if (this._isInsideExternalPlayer(e.target)) return;

                // Queue first — a queue trigger nested in (or alongside) a
                // play trigger must enqueue, not play. This mirrors the old
                // per-element handler's stopPropagation() semantics.
                const queueEl = (e.target as Element | null)?.closest?.<HTMLElement>('[data-wb-queue]');
                if (queueEl) {
                    e.preventDefault();
                    const track = parseTrackFromElement(queueEl);
                    if (track) this.addToQueue(track);
                    return;
                }

                const playEl = (e.target as Element | null)?.closest?.<HTMLElement>('[data-wb-play]');
                if (playEl) {
                    e.preventDefault();
                    const track = parseTrackFromElement(playEl);
                    if (track) this.play(track);
                }
            };
            document.addEventListener('click', this._docClickTriggers);
        }

        // External-mode WaveformPlayer instances on the page act as
        // visualization surfaces controlled by this bar — see the
        // `audioMode: 'external'` option in @arraypress/waveform-player.
        // Each instance dispatches `waveformplayer:request-play`
        // (cancelable) when its play button is clicked; we route that
        // into this bar so the audio always lives in one place.
        this._attachExternalPlayers();
    }

    /**
     * Discover external-mode WaveformPlayer instances and listen for
     * their request-play / request-pause / request-seek events. Also
     * builds a url → Set<WaveformPlayer> map used by _syncPageState()
     * and the onTimeUpdate callback to push state into the matching
     * inline visualizations.
     *
     * Idempotent — safe to call repeatedly. Late-mounted players are
     * picked up by the MutationObserver in _observeDOM().
     *
     * @internal
     */
    _attachExternalPlayers() {
        // Document-level listeners only bind once. Stored on `this` so
        // destroy() can remove them (they were previously anonymous and
        // leaked across re-inits).
        if (!this._externalListenersBound) {
            this._externalListenersBound = true;

            this._onExtRequestPlay = (e) => {
                // The detail is the player's view of its track: its `id` is a
                // DOM/generated id and `player` is the instance itself, so only
                // the track fields are taken (see normalizeTrack).
                let track = normalizeTrack(e.detail, {fromPlayer: true});
                if (!track) return;
                e.preventDefault();
                // The documented markup makes one element both the inline
                // player and a [data-wb-play] trigger. Its bubbled click is
                // ignored (see _docClickTriggers), so fold the trigger's
                // richer data-wb-* metadata (real id, link, meta…) in here. The
                // player's own non-empty fields still win over the trigger's
                // fallbacks (e.g. a title derived from the URL).
                const triggerEl = (e.target as Element | null)?.closest?.<HTMLElement>('[data-wb-play], [data-wb-queue]');
                const fromTrigger = triggerEl ? parseTrackFromElement(triggerEl) : null;
                if (fromTrigger && fromTrigger.url === track.url) track = mergeTrack(fromTrigger, track);
                this.play(track);
            };

            this._onExtRequestPause = (e) => {
                const t = e.detail;
                if (!t || !t.url) return;
                // Only honour pause when this is the currently-playing
                // track — pause requests from other players are noise.
                const current = this.getCurrentTrack();
                if (current && current.url === t.url) {
                    e.preventDefault();
                    if (this.isPlaying) this.togglePlay();
                }
            };

            this._onExtRequestSeek = (e) => {
                const t = e.detail;
                if (!t || !t.url || typeof t.percent !== 'number') return;
                const current = this.getCurrentTrack();
                if (current && current.url === t.url && this.player && this.player.audio) {
                    e.preventDefault();
                    this.player.seekToPercent(t.percent);
                }
            };

            // Prune a destroyed external player from the URL → players map
            // so we don't keep pumping state into a torn-down instance.
            this._onExtDestroy = (e) => {
                const inst = e.detail && e.detail.player;
                if (!inst || !this._externalPlayers) return;
                this._externalPlayers.forEach((set) => set.delete(inst));
            };

            document.addEventListener('waveformplayer:request-play', this._onExtRequestPlay as EventListener);
            document.addEventListener('waveformplayer:request-pause', this._onExtRequestPause as EventListener);
            document.addEventListener('waveformplayer:request-seek', this._onExtRequestSeek as EventListener);
            document.addEventListener('waveformplayer:destroy', this._onExtDestroy as EventListener);
        }

        // Rebuild the URL → players map from scratch each pass — cheap
        // (single querySelectorAll + Map insert) and avoids stale entries
        // for players that have been torn down. Late-mounted players
        // come in via the MutationObserver tick.
        const previous = this._externalPlayers || new Map();
        this._externalPlayers = new Map();
        const WP = window.WaveformPlayer;
        if (!WP || !WP.instances) return;

        // Match instances by container, not by `el.id`: a player whose element
        // has no id registers under a generated `wp_…` key that is never
        // written back to the element, so an id lookup silently missed every
        // id-less inline player (the documented markup has none).
        const byContainer = new Map();
        WP.instances.forEach((p) => {
            if (p && p.container) byContainer.set(p.container, p);
        });

        const newlyDiscovered: {inst: WaveformPlayer; url: string}[] = [];
        document.querySelectorAll('[data-waveform-player][data-audio-mode="external"]').forEach((el) => {
            const inst = byContainer.get(el);
            if (!inst || !inst.options || !inst.options.url) return;
            const url = inst.options.url;
            if (!this._externalPlayers.has(url)) this._externalPlayers.set(url, new Set());
            this._externalPlayers.get(url)!.add(inst);
            // Track players that weren't in the previous map — those need
            // initial state seeded so cross-page navigation (bar already
            // playing when an inline player mounts) syncs correctly.
            const wasKnown = previous.get(url) && previous.get(url)!.has(inst);
            if (!wasKnown) newlyDiscovered.push({inst, url});
        });

        // Seed newly-discovered players with current bar state. Without
        // this, an inline player that mounts AFTER the bar is already
        // playing would show "paused" until the next state event fires
        // (which might never happen if the user just sits on the page).
        if (newlyDiscovered.length) {
            const current = this.getCurrentTrack();
            const currentUrl = current ? current.url : null;
            newlyDiscovered.forEach(({inst, url}) => {
                const isCurrent = url === currentUrl;
                if (typeof inst.setPlayingState === 'function') {
                    inst.setPlayingState(isCurrent && this.isPlaying);
                }
                if (isCurrent && typeof inst.setProgress === 'function' && this.player && this.player.audio) {
                    inst.setProgress(this.player.audio.currentTime || 0, this.player.audio.duration || 0);
                }
            });
        }
    }

    /**
     * Whether a node sits inside the container of an external-mode player the
     * bar has registered. Only registered players count — a
     * `[data-waveform-player]` element that never mounted (or runs in self
     * mode) emits no request-* events, so its trigger clicks must still work.
     *
     * @internal
     * @param target
     */
    _isInsideExternalPlayer(target: EventTarget | null): boolean {
        const el = (target as Element | null)?.closest?.('[data-waveform-player]');
        if (!el || !this._externalPlayers) return false;
        for (const set of this._externalPlayers.values()) {
            for (const inst of set) {
                if (inst.container === el) return true;
            }
        }
        return false;
    }

    /**
     * Push playing-state into every external-mode player whose URL
     * matches the currently playing track. Other URLs get set to
     * false (paused) — covers the case where the bar switched tracks
     * and the previously-current external player should stop showing
     * its play indicator.
     *
     * @internal
     * @param playing
     */
    _pumpExternalPlayState(playing: boolean) {
        if (!this._externalPlayers || this._externalPlayers.size === 0) return;
        const current = this.getCurrentTrack();
        const currentUrl = current ? current.url : null;
        this._externalPlayers.forEach((set, url) => {
            const isCurrent = url === currentUrl;
            set.forEach((player) => {
                if (typeof player.setPlayingState === 'function') {
                    player.setPlayingState(isCurrent && playing);
                }
            });
        });
    }

    /**
     * Push progress (currentTime + duration) into the external-mode
     * player(s) tracking the current URL. Called on every timeupdate
     * tick of the internal player.
     *
     * @internal
     * @param currentTime
     * @param duration
     */
    _pumpExternalProgress(currentTime: number, duration: number) {
        if (!this._externalPlayers || this._externalPlayers.size === 0) return;
        const current = this.getCurrentTrack();
        if (!current) return;
        const set = this._externalPlayers.get(current.url);
        if (!set) return;
        set.forEach((player) => {
            if (typeof player.setProgress === 'function') {
                player.setProgress(currentTime, duration);
            }
        });
    }

    /** @internal */
    _observeDOM() {
        if (typeof MutationObserver === 'undefined') return;
        // Triggers are handled by the single delegated listener, so the
        // observer only needs to (re)discover late-mounted external-mode
        // players and re-sync page state.
        //
        // Mutations the bar causes itself are ignored — its time text changes
        // on every timeupdate tick, as does each inline player's time display
        // under setProgress(), and each used to trigger a full rescan. The
        // rest are debounced so a burst (a list render, infinite scroll)
        // rescans once.
        this._observer = new MutationObserver((mutations) => {
            if (mutations.every(m => this._isOwnMutation(m.target))) return;
            clearTimeout(this._observeTimeout as Timer | undefined);
            this._observeTimeout = setTimeout(() => {
                this._observeTimeout = null;
                this._attachExternalPlayers();
                this._syncPageState();
            }, 50);
        });
        this._observer.observe(document.body, {childList: true, subtree: true});
    }

    /**
     * Whether a mutated node belongs to DOM the bar itself keeps updating: the
     * bar, its queue panel, or a registered inline player's own markup.
     * @internal
     * @param node
     */
    _isOwnMutation(node: Node): boolean {
        if (this.barEl?.contains(node) || this.queueEl?.contains(node)) return true;
        const el = node.nodeType === 1 ? node : node.parentElement;
        return !!el && this._isInsideExternalPlayer(el);
    }

    // =====================================================================
    // Playback (public)
    // =====================================================================

    /**
     * Play a track immediately
     * @param trackOrUrl
     */
    play(trackOrUrl: WaveformBarTrack | string): WaveformBar {
        const track = toTrack(trackOrUrl);
        if (!track) return this;

        const current = this.getCurrentTrack();
        if (current && current.url === track.url) {
            this.togglePlay();
            return this;
        }

        const existing = this.queue.findIndex(t => t.url === track.url);
        if (existing >= 0) {
            // Merge new track data into existing queue entry so markers,
            // waveform, and other properties get updated — but never with
            // empty values, which would wipe good queued data.
            this.queue[existing] = mergeTrack(this.queue[existing], track);
            this.currentIndex = existing;
        } else {
            const insertAt = this.currentIndex + 1;
            this.queue.splice(insertAt, 0, track);
            this.currentIndex = insertAt;
        }

        this._loadCurrentTrack();
        return this;
    }

    /**
     * Add to end of queue
     * @param trackOrUrl
     */
    addToQueue(trackOrUrl: WaveformBarTrack | string): WaveformBar {
        const track = toTrack(trackOrUrl);
        if (!track) return this;
        if (this.queue.find(t => t.url === track.url)) return this;

        this.queue.push(track);
        this._renderQueue();
        this._saveState();
        this._updateNavButtons();

        if (this.currentIndex === -1) {
            this.currentIndex = 0;
            this._loadCurrentTrack();
        }

        this._emit('queuechange', {queue: this.queue, currentIndex: this.currentIndex});
        if (this.config.onQueueChange) this.config.onQueueChange(this.queue, this.currentIndex);
        return this;
    }

    togglePlay() {
        if (!this.player) return this;
        this.isPlaying ? this.player.pause() : this._playSafely();
        return this;
    }

    /**
     * Start the embedded player, absorbing a refused play(). Blocked
     * autoplay (NotAllowedError) or an unplayable source rejects the promise;
     * uncaught, that was an unhandled rejection, and if the 'play' event had
     * already flipped `isPlaying` the bar stayed showing "playing" forever.
     * @internal
     */
    _playSafely() {
        const restore = () => {
            this.isPlaying = false;
            this._updatePlayButton();
            this._syncPageState();
            this._pumpExternalPlayState(false);
        };
        try {
            const p = this.player && this.player.play();
            if (p && typeof p.catch === 'function') p.catch(restore);
        } catch (e) {
            restore();
        }
    }

    pause() {
        if (this.player && this.isPlaying) this.player.pause();
        return this;
    }

    next() {
        if (this.shuffle && this.queue.length > 1) {
            const i = this._nextShuffleIndex();
            if (i >= 0) {
                this.currentIndex = i;
                this._loadCurrentTrack();
            }
            return this;
        }
        if (this.currentIndex < this.queue.length - 1) {
            this.currentIndex++;
            this._loadCurrentTrack();
        } else if (this.repeat === 'all' && this.queue.length > 0) {
            this.currentIndex = 0;
            this._loadCurrentTrack();
        }
        return this;
    }

    previous() {
        if (this.player && this.player.audio && this.player.audio.currentTime > 3) {
            this.player.seekTo(0);
            return this;
        }
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this._loadCurrentTrack();
        } else if (this.repeat === 'all' && this.queue.length > 0) {
            this.currentIndex = this.queue.length - 1;
            this._loadCurrentTrack();
        }
        return this;
    }

    skipTo(index: number): WaveformBar {
        if (index < 0 || index >= this.queue.length) return this;
        if (index === this.currentIndex) {
            this.togglePlay();
            return this;
        }
        this.currentIndex = index;
        this._loadCurrentTrack();
        return this;
    }

    /**
     * Seek to a specific marker by index on the current track
     * @param markerIndex
     */
    seekToMarker(markerIndex: number): WaveformBar {
        if (!this._activeMarkers || markerIndex < 0 || markerIndex >= this._activeMarkers.length) return this;
        const marker = this._activeMarkers[markerIndex];
        if (this.player) {
            this.player.seekTo(marker.time);
            if (!this.isPlaying) this.togglePlay();
        }
        return this;
    }

    /**
     * Seek to a marker by label on the current track
     * @param label
     */
    seekToMarkerByLabel(label: string): WaveformBar {
        if (!this._activeMarkers) return this;
        const index = this._activeMarkers.findIndex(m =>
            (m.label || m.title || '').toLowerCase() === label.toLowerCase()
        );
        if (index >= 0) this.seekToMarker(index);
        return this;
    }

    // =====================================================================
    // Volume (public)
    // =====================================================================

    setVolume(level: number): WaveformBar {
        this.volume = Math.max(0, Math.min(1, level));
        this.isMuted = this.volume === 0;
        if (this.player) this.player.setVolume(this.volume);
        this._updateVolumeUI();
        this._persistVolume();
        this._emit('volumechange', {volume: this.volume});
        if (this.config.onVolumeChange) this.config.onVolumeChange(this.volume);
        return this;
    }

    getVolume(): number {
        return this.volume;
    }

    toggleMute() {
        if (this.isMuted) {
            this.setVolume(this._volumeBeforeMute || 1);
        } else {
            this._volumeBeforeMute = this.volume;
            this.isMuted = true;
            if (this.player) this.player.setVolume(0);
            this._updateVolumeUI();
            // Persist the muted flag — the unmute branch routes through
            // setVolume() (which saves), so mute must save too.
            this._persistVolume();
        }
        return this;
    }

    // =====================================================================
    // Actions (public)
    // =====================================================================

    toggleFavorite() {
        const track = this.getCurrentTrack();
        if (!track) return this;

        const id = track.id || track.url;
        const wasFav = this._favorites.has(id);

        if (wasFav) {
            this._favorites.delete(id);
        } else {
            this._favorites.add(id);
        }

        this._updateFavoriteUI();
        this._syncFavoriteAttributes(track.url, !wasFav);
        if (this.config.persist) saveFavorites(this.config.storageKey, this._favorites);

        this._emit('favorite', {track, favorited: !wasFav});
        if (this.config.onFavorite) this.config.onFavorite(track, !wasFav);

        if (this.config.actions?.favorite) {
            fireAction(this.config.actions.favorite, {
                action: 'favorite', id, url: track.url, title: track.title, favorited: !wasFav
            });
        }

        return this;
    }

    addToCart() {
        const track = this.getCurrentTrack();
        if (!track) return this;

        const id = track.id || track.url;
        this._cartItems.add(id);

        // Visual feedback on bar button
        if (this.cartBtnEl) {
            this.cartBtnEl.classList.add('wb-action-done');
            setTimeout(() => {
                if (this.cartBtnEl) this.cartBtnEl.classList.remove('wb-action-done');
            }, 1500);
        }

        // Sync data attribute back to page triggers
        this._syncCartAttributes(track.url, true);

        this._emit('cart', {track});
        if (this.config.onCart) this.config.onCart(track);

        if (this.config.actions?.cart) {
            fireAction(this.config.actions.cart, {
                action: 'cart', id, url: track.url, title: track.title
            });
        }

        return this;
    }

    isFavorited(id?: string | null): boolean {
        if (!id) {
            const t = this.getCurrentTrack();
            id = t ? (t.id || t.url) : null;
        }
        return id ? this._favorites.has(id) : false;
    }

    isInCart(id?: string | null): boolean {
        if (!id) {
            const t = this.getCurrentTrack();
            id = t ? (t.id || t.url) : null;
        }
        return id ? this._cartItems.has(id) : false;
    }

    // =====================================================================
    // Queue (public)
    // =====================================================================

    removeFromQueue(index: number): WaveformBar {
        if (index < 0 || index >= this.queue.length || index === this.currentIndex) return this;
        this.queue.splice(index, 1);
        if (index < this.currentIndex) this.currentIndex--;
        this._renderQueue();
        this._saveState();
        this._updateNavButtons();
        this._emit('queuechange', {queue: this.queue, currentIndex: this.currentIndex});
        if (this.config.onQueueChange) this.config.onQueueChange(this.queue, this.currentIndex);
        return this;
    }

    clearQueue() {
        const current = this.getCurrentTrack();
        this.queue = current ? [current] : [];
        this.currentIndex = current ? 0 : -1;
        this._shufflePlayed = new Set(current ? [current.url] : []);
        this._renderQueue();
        this._saveState();
        this._updateNavButtons();
        this._emit('queuechange', {queue: this.queue, currentIndex: this.currentIndex});
        if (this.config.onQueueChange) this.config.onQueueChange(this.queue, this.currentIndex);
        return this;
    }

    getCurrentTrack(): WaveformBarTrack | null {
        return (this.currentIndex >= 0 && this.currentIndex < this.queue.length) ? this.queue[this.currentIndex] : null;
    }

    getQueue(): WaveformBarTrack[] {
        return [...this.queue];
    }

    getCurrentIndex(): number {
        return this.currentIndex;
    }

    isCurrentlyPlaying(url: string): boolean | null {
        const c = this.getCurrentTrack();
        return this.isPlaying && c && c.url === url;
    }

    isCurrentTrack(url: string): boolean | null {
        const c = this.getCurrentTrack();
        return c && c.url === url;
    }

    getPlayer(): WaveformPlayer | null {
        return this.player;
    }

    // =====================================================================
    // Events
    // =====================================================================

    /**
     * Dispatch a custom DOM event on the bar element.
     * All events bubble and are prefixed with 'waveformbar:'.
     *
     * Events dispatched:
     * - waveformbar:play        { track }
     * - waveformbar:pause       { track }
     * - waveformbar:trackchange { track, index }
     * - waveformbar:markerchange { marker, index, track }
     * - waveformbar:favorite    { track, favorited }
     * - waveformbar:cart        { track }
     * - waveformbar:queuechange { queue, currentIndex }
     * - waveformbar:volumechange { volume }
     *
     * @internal
     * @param name - Event name (without prefix)
     * @param detail - Event detail data
     */
    _emit(name: string, detail: object = {}): void {
        if (!this.barEl) return;
        this.barEl.dispatchEvent(new CustomEvent('waveformbar:' + name, {
            bubbles: true,
            detail
        }));
    }

    // =====================================================================
    // UI: Bar visibility & Queue panel
    // =====================================================================

    show() {
        if (this.barEl) {
            this.barEl.classList.add('wb-active');
            this.barEl.removeAttribute('inert');
        }
        return this;
    }

    hide() {
        if (this.barEl) {
            this.barEl.classList.remove('wb-active');
            // Unfocusable while hidden — see _createBar().
            this.barEl.setAttribute('inert', '');
        }
        this.closeQueuePanel();
        this.closeVolumePopup();
        return this;
    }

    toggleQueuePanel() {
        return this.queueOpen ? this.closeQueuePanel() : this.openQueuePanel();
    }

    openQueuePanel() {
        if (!this.queueEl) return this;
        this.queueOpen = true;
        this.closeVolumePopup();

        // Position above the queue button
        if (this.queueBtnEl) {
            const rect = this.queueBtnEl.getBoundingClientRect();
            this.queueEl.style.right = (window.innerWidth - rect.right) + 'px';
        }

        this.queueEl.classList.add('wb-queue-open');
        if (this.queueBtnEl) {
            this.queueBtnEl.classList.add('wb-active');
            this.queueBtnEl.setAttribute('aria-expanded', 'true');
        }
        this._renderQueue();
        return this;
    }

    closeQueuePanel() {
        if (!this.queueEl) return this;
        this.queueOpen = false;
        this.queueEl.classList.remove('wb-queue-open');
        if (this.queueBtnEl) {
            this.queueBtnEl.classList.remove('wb-active');
            this.queueBtnEl.setAttribute('aria-expanded', 'false');
        }
        return this;
    }

    toggleVolumePopup() {
        if (this.volumePopupEl?.classList.contains('wb-volume-open')) {
            this.closeVolumePopup();
        } else {
            this.openVolumePopup();
        }
        return this;
    }

    openVolumePopup() {
        if (!this.volumePopupEl) return this;
        this.closeQueuePanel();
        this.volumePopupEl.classList.add('wb-volume-open');
        if (this.muteBtnEl) this.muteBtnEl.classList.add('wb-active');
        return this;
    }

    closeVolumePopup() {
        if (!this.volumePopupEl) return this;
        this.volumePopupEl.classList.remove('wb-volume-open');
        if (this.muteBtnEl) this.muteBtnEl.classList.remove('wb-active');
        return this;
    }

    // =====================================================================
    // Internal: Loading & Display
    // =====================================================================

    /**
     * Parse a share link from the URL: the timestamp (`?<shareParam>=`, seconds)
     * plus the track identity needed to load it cold — `?wid` (id, preferred),
     * `?wu` (url, the works-anywhere fallback), and `?wtitle`/`?wartist` for
     * display before metadata arrives. Returns null when no share params are
     * present. An unsafe `?wu` (javascript:/data: etc.) is dropped, not loaded.
     * @internal
     */
    _readShareTarget(): ShareTarget | null {
        let q;
        try {
            q = new URLSearchParams(window.location.search);
        } catch (e) {
            return null;
        }
        const rawTime = q.get(this.config.shareParam);
        const id = q.get('wid');
        const rawUrl = q.get('wu');
        if (rawTime == null && id == null && rawUrl == null) return null;

        let time = 0;
        if (rawTime != null) {
            const t = Number(rawTime);
            if (Number.isFinite(t) && t >= 0) time = t;
        }
        // Only honour an embedded url that's a safe http(s)/relative target —
        // the value is attacker-controllable, so never let it be javascript:.
        const url = (rawUrl && isSafeHref(rawUrl)) ? rawUrl : null;

        return {time, id: id || null, url, title: q.get('wtitle'), artist: q.get('wartist')};
    }

    /**
     * Resolve a share target to a loadable track. Prefers an on-page trigger
     * (matched by `data-wb-id`, then by url) so the cold load inherits the
     * page's pre-generated peaks, markers, and favorite/cart state; falls back
     * to a minimal track built from the embedded url + title/artist so the link
     * still works on a page that doesn't contain the track.
     * @param target
     * @internal
     */
    _resolveSharedTrack(target: ShareTarget): WaveformBarTrack | null {
        const triggers = document.querySelectorAll<HTMLElement>('[data-wb-play], [data-wb-queue]');

        // 1. By id (clean, short links). Skips when no id was shared.
        if (target.id) {
            for (const el of triggers) {
                if (el.dataset.wbId === target.id || el.dataset.id === target.id) {
                    const t = parseTrackFromElement(el);
                    if (t) return t;
                }
            }
        }

        // 2. By url — match an on-page trigger to inherit its peaks/state...
        if (target.url) {
            for (const el of triggers) {
                if (el.dataset.wbUrl === target.url || el.dataset.url === target.url) {
                    const t = parseTrackFromElement(el);
                    if (t) return t;
                }
            }
            // 3. ...else build a minimal track straight from the link (cross-page).
            return {
                url: target.url,
                id: target.id || target.url,
                title: target.title || extractTitle(target.url),
                artist: target.artist || ''
            };
        }

        return null;
    }

    /**
     * Cold-load a share-target track at a timestamp, paused. Mirrors the
     * restore path (loadTrack with autoplay:false + a `_loadSeq`-guarded,
     * delayed seek) so a later user action cleanly supersedes it.
     * @param track
     * @param time - seconds to seek to once loaded
     * @internal
     */
    _loadSharedTrack(track: WaveformBarTrack, time: number): void {
        if (!track || !track.url || !this.player) return;

        // Make it the current queue entry (dedup by url, like play()).
        const existing = this.queue.findIndex(t => t.url === track.url);
        if (existing >= 0) {
            this.queue[existing] = mergeTrack(this.queue[existing], track);
            this.currentIndex = existing;
        } else {
            this.queue.push(track);
            this.currentIndex = this.queue.length - 1;
        }

        this.show();
        this._updateTrackDisplay(track);
        this._updateFavoriteUI();
        this._updateNavButtons();

        const loadOpts: Record<string, any> = {autoplay: false};
        if (track.waveform) loadOpts.waveform = track.waveform;
        if (track.markers && track.markers.length) {
            const defaultColor = this.config.markerColor;
            loadOpts.markers = track.markers.map(m => ({...m, color: m.color || defaultColor}));
            this._activeMarkers = track.markers;
        } else {
            loadOpts.markers = [];
            this._activeMarkers = null;
        }
        this._currentMarkerIndex = -1;

        const seq = ++this._loadSeq;
        if (this._restoreSeekTimeout) {
            clearTimeout(this._restoreSeekTimeout);
            this._restoreSeekTimeout = null;
        }
        // Resume position belongs to the previous track (see _loadCurrentTrack).
        this._lastPosition = 0;
        this._lastSaveTime = 0;

        this.player.loadTrack(track.url, track.title, track.artist, loadOpts).then(() => {
            if (this._loadSeq !== seq) return;
            if (this.player) this.player.setVolume(this.isMuted ? 0 : this.volume);
            // Seek slightly after load — the audio element needs to be ready
            // for the seek to stick (same 100ms guard the restore path uses).
            if (time > 0) {
                this._restoreSeekTimeout = setTimeout(() => {
                    this._restoreSeekTimeout = null;
                    if (this._loadSeq !== seq) return;
                    if (this.player) {
                        this.player.seekTo(time);
                        this._lastPosition = time;
                    }
                }, 100);
            }
        }).catch(() => {});

        this._renderQueue();
        this._syncPageState();
        this._saveState();
        this._updateNavButtons();
        this._emit('trackchange', {track, index: this.currentIndex});
        if (this.config.onTrackChange) this.config.onTrackChange(track, this.currentIndex);
    }

    /**
     * Copy a shareable link to the current track at the current position, use
     * the native share sheet when available, and emit `waveformbar:share`. The
     * link carries both the timestamp AND the track identity so a cold open
     * loads the right audio: `?<shareParam>=<seconds>` plus `wid` (id, when the
     * track has a real one), `wu` (url — the works-anywhere fallback), and
     * `wtitle`/`wartist` for display before metadata loads.
     * @internal
     */
    _share() {
        const track = this.getCurrentTrack();
        const cur = this.player && this.player.audio ? this.player.audio.currentTime : 0;
        const seconds = Math.max(0, Math.floor(cur || 0));
        let link;
        try {
            const url = new URL(window.location.href);
            const p = url.searchParams;
            p.set(this.config.shareParam, String(seconds));
            if (track) {
                // id falls back to url internally, so only emit wid when it's a
                // real, distinct identifier (clean per-track-page links).
                if (track.id && track.id !== track.url) p.set('wid', track.id);
                if (track.url) p.set('wu', track.url);
                if (track.title) p.set('wtitle', track.title);
                if (track.artist) p.set('wartist', track.artist);
            }
            link = url.toString();
        } catch (e) {
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).catch(() => {});
        }
        if (navigator.share) {
            navigator.share({title: (track && track.title) || undefined, url: link}).catch(() => {});
        }
        this._flashShareCopied();
        this._emit('share', {url: link, time: seconds, track});
    }

    /**
     * Briefly flag the share button as "copied" for visual feedback.
     * @internal
     */
    _flashShareCopied() {
        if (!this.shareBtnEl) return;
        this.shareBtnEl.classList.add('wb-copied');
        this.shareBtnEl.setAttribute('title', 'Link copied!');
        clearTimeout(this._shareFlashTimeout as Timer | undefined);
        this._shareFlashTimeout = setTimeout(() => {
            if (this.shareBtnEl) {
                this.shareBtnEl.classList.remove('wb-copied');
                this.shareBtnEl.setAttribute('title', 'Copy share link');
            }
        }, 1500);
    }

    /**
     * Collapse the bar to a small floating pill (artwork + play + expand).
     */
    collapse(): WaveformBar {
        this.isCollapsed = true;
        if (this.barEl) this.barEl.classList.add('wb-collapsed');
        this._updateCollapseButton();
        this._saveCollapsed();
        this._emit('collapse', {collapsed: true});
        return this;
    }

    /**
     * Restore the bar from its collapsed pill back to the full bar.
     */
    expand(): WaveformBar {
        this.isCollapsed = false;
        if (this.barEl) this.barEl.classList.remove('wb-collapsed');
        this._updateCollapseButton();
        this._saveCollapsed();
        this._emit('collapse', {collapsed: false});
        return this;
    }

    /**
     * Toggle the collapsed pill state.
     */
    toggleCollapse(): WaveformBar {
        return this.isCollapsed ? this.expand() : this.collapse();
    }

    /**
     * Swap the collapse button's icon + labels for the current state.
     * @internal
     */
    _updateCollapseButton() {
        if (!this.collapseBtnEl) return;
        this.collapseBtnEl.innerHTML = this.isCollapsed ? ICONS.expand : ICONS.collapse;
        const label = this.isCollapsed ? 'Expand' : 'Collapse';
        this.collapseBtnEl.setAttribute('aria-label', label);
        this.collapseBtnEl.setAttribute('title', label);
        this.collapseBtnEl.setAttribute('aria-expanded', this.isCollapsed ? 'false' : 'true');
    }

    /** Persist the collapsed state (session-scoped) when persistence is on. @internal */
    _saveCollapsed() {
        if (!this.config.persist) return;
        try {
            sessionStorage.setItem(this.config.storageKey + '-collapsed', this.isCollapsed ? '1' : '0');
        } catch (e) {}
    }

    /** Read the persisted collapsed state. @internal */
    _readCollapsed(): boolean {
        if (!this.config.persist) return false;
        try {
            return sessionStorage.getItem(this.config.storageKey + '-collapsed') === '1';
        } catch (e) {
            return false;
        }
    }

    /** @internal */
    _loadCurrentTrack() {
        const track = this.getCurrentTrack();
        if (!track || !this.player) return;

        // Bump the load token and cancel any pending restore-seek so a
        // stale async continuation (from a prior load) can't apply to this
        // newer track under rapid switching.
        this._loadSeq++;
        if (this._restoreSeekTimeout) {
            clearTimeout(this._restoreSeekTimeout);
            this._restoreSeekTimeout = null;
        }

        // The resume position belongs to the previous track. Left as-is, the
        // save below would persist it against the new one, and the throttled
        // save in onTimeUpdate would stay quiet until the new track climbed
        // past the old track's last-save time.
        this._lastPosition = 0;
        this._lastSaveTime = 0;
        this._shufflePlayed.add(track.url);

        // Reset any previously-current external player so its UI flips
        // back to "paused" while the new track loads. The new track's
        // onPlay callback will set the matching external to playing
        // once playback actually starts.
        this._pumpExternalPlayState(false);

        this.show();
        this._updateTrackDisplay(track);
        this._updateFavoriteUI();

        const loadOpts: Record<string, any> = {artwork: track.artwork, album: track.album};

        // Pass pre-existing waveform data if available
        if (track.waveform) {
            loadOpts.waveform = track.waveform;
        }

        // Always pass markers — empty array clears previous track's markers
        if (track.markers && track.markers.length) {
            const defaultColor = this.config.markerColor;
            loadOpts.markers = track.markers.map(m => ({
                ...m,
                color: m.color || defaultColor
            }));
        } else {
            loadOpts.markers = [];
        }
        // A failed load surfaces through onError; don't also leak the
        // rejected promise as an unhandled rejection.
        const loading = this.player.loadTrack(track.url, track.title, track.artist, loadOpts);
        if (loading && typeof loading.catch === 'function') loading.catch(() => {});

        // Store markers for DJ mode (dynamic title/artist updates)
        this._activeMarkers = track.markers && track.markers.length ? track.markers : null;
        this._currentMarkerIndex = -1;

        if (this.player) this.player.setVolume(this.isMuted ? 0 : this.volume);

        this._renderQueue();
        this._syncPageState();
        this._saveState();
        this._updateNavButtons();

        this._emit('trackchange', {track, index: this.currentIndex});
        if (this.config.onTrackChange) this.config.onTrackChange(track, this.currentIndex);
    }

    /** @internal */
    _updateTrackDisplay(track: WaveformBarTrack): void {
        if (this.titleEl) this._setScrollText(this.titleEl, track.title || 'Untitled');
        if (this.artistEl) this._setScrollText(this.artistEl, track.artist || '');

        const artworkEl = this.barEl!.querySelector('.wb-artwork');
        if (artworkEl) {
            const artworkUrl = track.artwork || this.config.defaultArtwork;
            artworkEl.innerHTML = artworkUrl
                ? `<img src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(track.title)}" />`
                : ICONS.music;
        }

        if (this.metaEl && this.config.showMeta) this._renderMeta(track);

        const trackEl = this.barEl!.querySelector<HTMLElement>('.wb-track');
        if (trackEl) trackEl.style.cursor = track.link ? 'pointer' : 'default';

        // Reset time
        if (this.timeCurrentEl) this.timeCurrentEl.textContent = '0:00';
        if (this.timeTotalEl) this.timeTotalEl.textContent = '0:00';
    }

    /**
     * Set text on an element with auto-scroll if it overflows.
     * @internal
     */
    _setScrollText(el: HTMLElement, text: string): void {
        el.classList.remove('wb-scrolling');
        el.textContent = text;

        // Check overflow after text is set
        requestAnimationFrame(() => {
            if (el.scrollWidth > el.clientWidth) {
                const overflow = el.scrollWidth - el.clientWidth;
                const duration = Math.max(4, overflow / 20); // ~20px/sec
                el.innerHTML = `<span class="wb-scroll-inner">${escapeHtml(text)}</span>`;
                el.style.setProperty('--wb-scroll-distance', `-${overflow + 48}px`);
                el.style.setProperty('--wb-scroll-duration', `${duration}s`);
                el.classList.add('wb-scrolling');
            }
        });
    }

    /** @internal */
    _renderMeta(track: WaveformBarTrack): void {
        if (!this.metaEl) return;
        const tags: {label: string | number; type: string}[] = [];
        if (track.bpm) tags.push({label: track.bpm + ' BPM', type: 'bpm'});
        if (track.key) tags.push({label: track.key, type: 'key'});
        if (track.duration) tags.push({label: track.duration, type: 'duration'});
        if (track.meta) {
            for (const [k, v] of Object.entries(track.meta)) {
                if (v && tags.length < this.config.maxMeta) tags.push({label: String(v), type: k});
            }
        }
        const limited = tags.slice(0, this.config.maxMeta);
        this.metaEl.style.display = limited.length ? 'flex' : 'none';
        this.metaEl.innerHTML = limited.map(t =>
            `<span class="wb-tag wb-tag-${escapeHtml(t.type)}">${escapeHtml(t.label)}</span>`
        ).join('');
    }

    /** @internal */
    _updatePlayButton() {
        if (!this.playBtnEl) return;
        const play = this.playBtnEl.querySelector<HTMLElement>('.wb-icon-play');
        const pause = this.playBtnEl.querySelector<HTMLElement>('.wb-icon-pause');
        if (play) play.style.display = this.isPlaying ? 'none' : 'block';
        if (pause) pause.style.display = this.isPlaying ? 'block' : 'none';
        this.playBtnEl.title = this.isPlaying ? 'Pause' : 'Play';
    }

    /** @internal */
    _updateNavButtons() {
        const prevBtn = this.barEl?.querySelector('.wb-prev');
        const nextBtn = this.barEl?.querySelector('.wb-next');
        if (this.repeat === 'all') {
            // When repeat-all, nav is always available (wraps around)
            if (prevBtn) prevBtn.classList.remove('wb-disabled');
            if (nextBtn) nextBtn.classList.remove('wb-disabled');
        } else {
            if (prevBtn) prevBtn.classList.toggle('wb-disabled', this.currentIndex <= 0);
            // Under shuffle, "next" is any unplayed track, not index + 1.
            const noNext = this.shuffle
                ? !this.queue.some((t, i) => i !== this.currentIndex && !this._shufflePlayed.has(t.url))
                : this.currentIndex >= this.queue.length - 1;
            if (nextBtn) nextBtn.classList.toggle('wb-disabled', noNext);
        }
    }

    // =====================================================================
    // Repeat
    // =====================================================================

    /**
     * Cycle through repeat modes: off → all → one → off
     */
    cycleRepeat(): WaveformBar {
        const modes: WaveformBarRepeatMode[] = ['off', 'all', 'one'];
        const current = modes.indexOf(this.repeat);
        this.repeat = modes[(current + 1) % modes.length];
        this._updateRepeatButton();
        this._updateNavButtons();
        this._emit('repeatchange', {mode: this.repeat});
        return this;
    }

    /**
     * Set repeat mode directly
     * @param mode
     */
    setRepeat(mode: WaveformBarRepeatMode): WaveformBar {
        if (['off', 'all', 'one'].includes(mode)) {
            this.repeat = mode;
            this._updateRepeatButton();
            this._updateNavButtons();
            this._emit('repeatchange', {mode: this.repeat});
        }
        return this;
    }

    /** @internal */
    _updateRepeatButton() {
        if (!this.repeatBtnEl) return;
        const icons = {off: ICONS.repeatOff, all: ICONS.repeatAll, one: ICONS.repeatOne};
        const labels = {off: 'Repeat: Off', all: 'Repeat: All', one: 'Repeat: One'};
        this.repeatBtnEl.innerHTML = icons[this.repeat];
        this.repeatBtnEl.title = labels[this.repeat];
        // Three modes don't fit aria-pressed alone: it says on/off, and the
        // label names which mode.
        this.repeatBtnEl.setAttribute('aria-label', labels[this.repeat]);
        this.repeatBtnEl.setAttribute('aria-pressed', this.repeat !== 'off' ? 'true' : 'false');
        this.repeatBtnEl.classList.toggle('wb-repeat-active', this.repeat !== 'off');
    }

    /**
     * Toggle shuffle (random queue advance) on / off.
     */
    toggleShuffle(): WaveformBar {
        return this.setShuffle(!this.shuffle);
    }

    /**
     * Set shuffle on / off directly.
     * @param on
     */
    setShuffle(on: boolean): WaveformBar {
        const wasOn = this.shuffle;
        this.shuffle = !!on;
        // Switching shuffle on starts a fresh pass from the current track.
        if (this.shuffle && !wasOn) {
            const current = this.getCurrentTrack();
            this._shufflePlayed = new Set(current ? [current.url] : []);
        }
        this._updateShuffleButton();
        this._updateNavButtons();
        this._emit('shufflechange', {shuffle: this.shuffle});
        if (this.config.onShuffleChange) this.config.onShuffleChange(this.shuffle);
        return this;
    }

    /** @internal */
    _updateShuffleButton() {
        if (!this.shuffleBtnEl) return;
        this.shuffleBtnEl.title = this.shuffle ? 'Shuffle: On' : 'Shuffle: Off';
        this.shuffleBtnEl.setAttribute('aria-pressed', this.shuffle ? 'true' : 'false');
        this.shuffleBtnEl.classList.toggle('wb-shuffle-active', this.shuffle);
    }

    /**
     * Pick a random queue index that isn't the current track and hasn't been
     * played in this shuffle pass. -1 when none is left.
     * @internal
     */
    _randomIndex(): number {
        const candidates: number[] = [];
        this.queue.forEach((t, i) => {
            if (i !== this.currentIndex && !this._shufflePlayed.has(t.url)) candidates.push(i);
        });
        if (!candidates.length) return -1;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    /**
     * The shuffle advance: a random upcoming track, or — once every track has
     * played — a fresh pass under repeat 'all', else -1 (stop).
     * @internal
     */
    _nextShuffleIndex(): number {
        let i = this._randomIndex();
        if (i < 0 && this.repeat === 'all') {
            const current = this.getCurrentTrack();
            this._shufflePlayed = new Set(current ? [current.url] : []);
            i = this._randomIndex();
        }
        return i;
    }

    /**
     * DJ mode: check if playback has crossed a marker boundary
     * and update the bar's title/artist/artwork/meta display.
     * Markers should be sorted by time and can include:
     * { time, label, title, artist, artwork, bpm, key }
     * @internal
     */
    _checkMarkerBoundary(currentTime: number): void {
        if (!this._activeMarkers) return;

        // Find the active marker (last marker whose time <= currentTime)
        let markerIndex = -1;
        for (let i = this._activeMarkers.length - 1; i >= 0; i--) {
            if (currentTime >= this._activeMarkers[i].time) {
                markerIndex = i;
                break;
            }
        }

        // Only update if we've moved to a different marker
        if (markerIndex === this._currentMarkerIndex) return;
        this._currentMarkerIndex = markerIndex;

        if (markerIndex < 0) return;

        const marker = this._activeMarkers[markerIndex];
        const track = this.getCurrentTrack();

        // Update title/artist if the marker provides them
        if (marker.title && this.titleEl) this._setScrollText(this.titleEl, marker.title);
        if (marker.artist && this.artistEl) this._setScrollText(this.artistEl, marker.artist);

        // Highlight the active marker on the waveform
        const markerEls = this.waveformContainer?.querySelectorAll('.waveform-marker');
        if (markerEls) {
            markerEls.forEach((el, i) => el.classList.toggle('wb-marker-active', i === markerIndex));
        }

        // Update artwork if provided
        if (marker.artwork) {
            const artworkEl = this.barEl!.querySelector('.wb-artwork');
            if (artworkEl) artworkEl.innerHTML = `<img src="${escapeHtml(marker.artwork)}" alt="${escapeHtml(marker.title || '')}" />`;
        }

        // Update meta tags if bpm/key provided
        if (this.metaEl && (marker.bpm || marker.key)) {
            const metaTrack = {
                ...(track || {}),
                bpm: marker.bpm || '',
                key: marker.key || ''
            } as WaveformBarTrack;
            this._renderMeta(metaTrack);
        }

        this._emit('markerchange', {marker, index: markerIndex, track});
    }

    /** @internal */
    _updateVolumeUI() {
        if (this.volumeSliderEl) {
            (this.volumeSliderEl as any).value = this.isMuted ? 0 : Math.round(this.volume * 100);
        }
        if (this.muteBtnEl) {
            if (this.isMuted || this.volume === 0) {
                this.muteBtnEl.innerHTML = ICONS.volMute;
                this.muteBtnEl.classList.add('wb-muted');
                this.muteBtnEl.title = 'Unmute';
            } else if (this.volume < 0.5) {
                this.muteBtnEl.innerHTML = ICONS.volLow;
                this.muteBtnEl.classList.remove('wb-muted');
                this.muteBtnEl.title = 'Mute';
            } else {
                this.muteBtnEl.innerHTML = ICONS.volHigh;
                this.muteBtnEl.classList.remove('wb-muted');
                this.muteBtnEl.title = 'Mute';
            }
        }
    }

    /**
     * Auto-detect light/dark theme from the page.
     *
     * Delegates to the core player's shared detector when it's available, so
     * the bar and the inline players can never disagree about the page theme —
     * they used to carry separate copies of this heuristic and drifted. The
     * local fallback below only runs against player builds older than 1.24.1,
     * which don't expose `utils.detectColorScheme`; it can go once the peer
     * range moves past that.
     *
     * @internal
     */
    _detectTheme(): 'dark' | 'light' {
        // Detect against <body>, never against `this.barEl`: the bar paints its
        // own `--wb-bg`, so starting the backdrop walk there would just read
        // back the theme it already has. The bar is position:fixed over the
        // page anyway, so what's behind it IS the page canvas.
        const shared = typeof window !== 'undefined' && window.WaveformPlayer?.utils?.detectColorScheme;
        if (typeof shared === 'function') {
            try {
                return shared(document.body);
            } catch (e) { /* fall through to the local copy */ }
        }
        return this._detectThemeFallback();
    }

    /**
     * Theme detection for older `@arraypress/waveform-player` builds.
     * Mirrors that package's `detectColorScheme` — keep the two in step.
     * @internal
     */
    _detectThemeFallback(): 'dark' | 'light' {
        const root = document.documentElement;
        const body = document.body;

        // 1. Explicit theme classes/attributes
        const darkIndicators = ['dark', 'dark-mode', 'theme-dark'];
        const lightIndicators = ['light', 'light-mode', 'theme-light'];

        for (const cls of darkIndicators) {
            if (root.classList.contains(cls) || body.classList.contains(cls)) return 'dark';
        }
        if (root.getAttribute('data-theme') === 'dark' || body.getAttribute('data-theme') === 'dark') return 'dark';

        for (const cls of lightIndicators) {
            if (root.classList.contains(cls) || body.classList.contains(cls)) return 'light';
        }
        if (root.getAttribute('data-theme') === 'light' || body.getAttribute('data-theme') === 'light') return 'light';

        // 2. The backdrop actually visible behind the bar: <body> and <html>,
        //    alpha-composited over the UA canvas. Reading <body>'s background
        //    as a colour on its own was the bug — it computes to
        //    `rgba(0, 0, 0, 0)` on any page that doesn't paint it, which scored
        //    as pure black and pinned the bar to dark on white pages.
        try {
            let sum = 0;
            let alpha = 0;

            for (let node: HTMLElement | null = body; node && node.nodeType === 1 && alpha < 0.995; node = node.parentElement) {
                const c: any = getComputedStyle(node).backgroundColor.match(/rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+))?/i);
                if (!c) continue;
                const a = c[4] === undefined ? 1 : Number(c[4]);
                if (!(a > 0)) continue;

                const weight = a * (1 - alpha);
                sum += ((c[1] * 299 + c[2] * 587 + c[3] * 114) / 1000) * weight;
                alpha += weight;
            }

            const brightness = sum + this._detectCanvasBrightness() * (1 - alpha);
            if (brightness > 128) return 'light';
            if (brightness < 128) return 'dark';
        } catch (e) {
        }

        return 'dark';
    }

    /**
     * Brightness (0–255) of the canvas behind the page, read from the resolved
     * text colour: light text means the document's used colour-scheme is dark.
     * Deliberately not `prefers-color-scheme` — see the core player's
     * `detectCanvasScheme` for why that signal is engine-specific and unusable
     * here.
     * @internal
     */
    _detectCanvasBrightness(): number {
        const text: any = getComputedStyle(document.body).color.match(/rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i);
        if (text) return (text[1] * 299 + text[2] * 587 + text[3] * 114) / 1000 > 128 ? 0 : 255;
        if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 0;
        if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 255;
        return 0;
    }

    /**
     * Re-detect the page theme and toggle the bar's `wb-light` class (on the bar
     * and the queue panel) to match, so the bar adapts to a runtime light/dark
     * switch — not just the theme present when it was first shown. No-op when
     * `config.theme` is set explicitly.
     * @internal
     */
    _refreshTheme() {
        if (this.config && this.config.theme) return;
        const theme = this._detectTheme();
        if (theme === this._resolvedTheme) return;
        this._resolvedTheme = theme;
        const light = theme === 'light';
        if (this.barEl) this.barEl.classList.toggle('wb-light', light);
        if (this.queueEl) this.queueEl.classList.toggle('wb-light', light);
    }

    /**
     * Watch the document for theme changes — a class/attribute flip on
     * `<html>`/`<body>` (Tailwind `dark`, `data-theme`, `data-color-scheme`) or
     * an OS `prefers-color-scheme` change — and re-detect. Event-driven
     * (MutationObserver + matchMedia), never a timer. Torn down in destroy().
     * @internal
     */
    _watchTheme() {
        if (typeof document === 'undefined') return;
        const refresh = () => requestAnimationFrame(() => this._refreshTheme());
        const opts = {attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'style']};
        this._themeObserver = new MutationObserver(refresh);
        this._themeObserver.observe(document.documentElement, opts);
        if (document.body) this._themeObserver.observe(document.body, opts);
        try {
            this._themeMq = window.matchMedia('(prefers-color-scheme: dark)');
            this._themeMqHandler = refresh;
            this._themeMq.addEventListener('change', this._themeMqHandler);
        } catch (e) { /* no matchMedia */ }
    }

    /** @internal */
    _updateFavoriteUI() {
        if (!this.favBtnEl) return;
        const fav = this.isFavorited();
        this.favBtnEl.innerHTML = fav ? ICONS.heartFilled : ICONS.heart;
        this.favBtnEl.classList.toggle('wb-fav-active', fav);
        this.favBtnEl.setAttribute('aria-pressed', fav ? 'true' : 'false');
        this.favBtnEl.title = fav ? 'Favorited' : 'Favorite';
    }

    /** @internal */
    _renderQueue() {
        renderQueue(this.queueBodyEl, this.queueCountEl, this.queue, this.currentIndex, {
            onSkipTo: (i) => this.skipTo(i),
            onRemove: (i) => this.removeFromQueue(i)
        });
    }

    // =====================================================================
    // Page State Sync
    // =====================================================================

    /**
     * Sync all state classes and attributes back to page trigger elements.
     *
     * Classes applied:
     * - .wb-current — track is current (playing or paused)
     * - .wb-playing — track is actively playing
     * - .wb-favorited — track is in favorites
     * - .wb-in-cart — track has been added to cart
     * @internal
     */
    _syncPageState() {
        const current = this.getCurrentTrack();
        const currentUrl = current ? current.url : null;

        document.querySelectorAll<HTMLElement>('[data-wb-play]').forEach(el => {
            const url = el.dataset.wbUrl || el.dataset.url;
            const id = el.dataset.wbId || el.dataset.id || url;
            // Typed boolean, but '' or undefined when the trigger has no url.
            // classList.toggle() takes '' as false and undefined as "no force".
            const isCurrent = (url && url === currentUrl) as boolean;

            // Play state
            el.classList.toggle('wb-current', isCurrent);
            el.classList.toggle('wb-playing', isCurrent && this.isPlaying);

            // Favorite state
            el.classList.toggle('wb-favorited', this._favorites.has(id as string));

            // Cart state
            el.classList.toggle('wb-in-cart', this._cartItems.has(id as string));
        });
    }

    /**
     * Seed favorites and cart state from data attributes on page elements.
     * This is the authoritative source — server renders the initial state,
     * and we read it on init. Overrides localStorage.
     * @internal
     */
    _seedFromAttributes() {
        let seededFav = false;
        let seededCart = false;

        document.querySelectorAll<HTMLElement>('[data-wb-play]').forEach(el => {
            const id = el.dataset.wbId || el.dataset.id || el.dataset.wbUrl || el.dataset.url;
            if (!id) return;

            // Seed favorites from data-wb-favorited="true"
            if (el.dataset.wbFavorited === 'true') {
                this._favorites.add(id);
                seededFav = true;
            }

            // Seed cart from data-wb-in-cart="true"
            if (el.dataset.wbInCart === 'true') {
                this._cartItems.add(id);
                seededCart = true;
            }
        });

        // If we seeded from attributes, save to storage so it persists
        if (seededFav && this.config.persist) {
            saveFavorites(this.config.storageKey, this._favorites);
        }
    }

    /**
     * Sync favorite state back to trigger element data attributes
     * @internal
     * @param url - Track URL to match
     * @param favorited - New state
     */
    _syncFavoriteAttributes(url: string, favorited: boolean) {
        document.querySelectorAll<HTMLElement>('[data-wb-play]').forEach(el => {
            const elUrl = el.dataset.wbUrl || el.dataset.url;
            if (elUrl === url) {
                el.dataset.wbFavorited = favorited ? 'true' : 'false';
                el.classList.toggle('wb-favorited', favorited);
            }
        });
    }

    /**
     * Sync cart state back to trigger element data attributes
     * @internal
     * @param url - Track URL to match
     * @param inCart - New state
     */
    _syncCartAttributes(url: string, inCart: boolean) {
        document.querySelectorAll<HTMLElement>('[data-wb-play]').forEach(el => {
            const elUrl = el.dataset.wbUrl || el.dataset.url;
            if (elUrl === url) {
                el.dataset.wbInCart = inCart ? 'true' : 'false';
                el.classList.toggle('wb-in-cart', inCart);
            }
        });
    }

    // =====================================================================
    // Persistence
    // =====================================================================

    /** @internal */
    _saveState() {
        if (!this.config.persist) return;
        saveQueueState(this.config.storageKey, {
            queue: this.queue,
            currentIndex: this.currentIndex,
            position: this._lastPosition || 0,
            isPlaying: this.isPlaying
        });
    }

    /** @internal */
    _restoreState() {
        if (!this.config.persist) return;
        const state = restoreQueueState(this.config.storageKey);
        if (!state) return;

        this.queue = state.queue;
        this.currentIndex = state.currentIndex;

        const track = this.getCurrentTrack();
        if (!track) return;

        this.show();
        this._updateTrackDisplay(track);
        this._updateFavoriteUI();
        this._updateNavButtons();

        // Use the public loadTrack() API with { autoplay: false } (core
        // v1.8.0+) instead of poking player.options.* + load(). This avoids
        // loadTrack's forced auto-play while still routing through the
        // supported API — we handle seek and resume manually below.
        const loadOpts: Record<string, any> = {autoplay: false};
        if (track.waveform) loadOpts.waveform = track.waveform;

        // Pass markers to the player and set up DJ mode
        if (track.markers && track.markers.length) {
            const defaultColor = this.config.markerColor;
            loadOpts.markers = track.markers.map(m => ({
                ...m,
                color: m.color || defaultColor
            }));
            this._activeMarkers = track.markers;
        } else {
            loadOpts.markers = [];
            this._activeMarkers = null;
        }
        this._currentMarkerIndex = -1;

        // Capture the load token so the async continuation below bails out if
        // a newer load (user clicked another track, or destroy()) supersedes
        // this restore before its promise / seek-timeout fires.
        const seq = ++this._loadSeq;
        if (this._restoreSeekTimeout) {
            clearTimeout(this._restoreSeekTimeout);
            this._restoreSeekTimeout = null;
        }

        this.player!.loadTrack(track.url, track.title, track.artist, loadOpts).then(() => {
            if (this._loadSeq !== seq) return;
            if (this.player) this.player.setVolume(this.isMuted ? 0 : this.volume);

            if (state.isPlaying && this.config.autoResume) {
                try {
                    const p = this.player!.play();
                    if (p && typeof p.catch === 'function') {
                        p.catch(() => {
                            this.isPlaying = false;
                            this._updatePlayButton();
                            this._syncPageState();
                        });
                    }
                } catch (e) {
                    this.isPlaying = false;
                    this._updatePlayButton();
                    this._syncPageState();
                }
            }

            // Seek after play — the audio element needs to be in a playing
            // or ready state for seek to stick reliably
            if (state.position > 0) {
                this._restoreSeekTimeout = setTimeout(() => {
                    this._restoreSeekTimeout = null;
                    if (this._loadSeq !== seq) return;
                    if (this.player) {
                        this.player.seekTo(state.position);
                        this._lastPosition = state.position;
                    }
                }, 100);
            }
        }).catch(() => {
        });

        this._renderQueue();
        this._syncPageState();
    }

    /**
     * Save volume + mute state — only when persistence is on. `persist: false`
     * is documented as "nothing is stored", localStorage included.
     * @internal
     */
    _persistVolume() {
        if (!this.config.persist) return;
        saveVolume(this.config.storageKey, this.volume, this.isMuted, this._volumeBeforeMute);
    }

    /** @internal */
    _restoreVolume() {
        const data = restoreVolume(this.config.storageKey);
        if (!data) return;
        // Normalize persisted volume — a corrupted store could otherwise
        // carry NaN / out-of-range and mute or break the player.
        const v = Number(data.volume);
        this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
        this.isMuted = data.muted;
        this._volumeBeforeMute = data.volumeBeforeMute;
        if (this.player) this.player.setVolume(this.isMuted ? 0 : this.volume);
        this._updateVolumeUI();
    }

    /** @internal */
    _restoreFavorites() {
        this._favorites = restoreFavorites(this.config.storageKey);
    }

}