/**
 * @module types
 * The public config, track, action and event types of WaveformBar. Type-only:
 * nothing here reaches the bundles.
 */

import type {WaveformStyle} from '@arraypress/waveform-player';

/** Repeat-mode cycle position: play the queue once, loop it, or loop the current track. */
export type WaveformBarRepeatMode = 'off' | 'all' | 'one';

/** Forced bar theme. `null` (default) auto-detects from the page. */
export type WaveformBarTheme = 'dark' | 'light';

/**
 * Display mode. `'waveform'` is the default layout with a waveform;
 * `'classic'` is the Spotify-style centred layout with a seek bar.
 */
export type WaveformBarMode = 'waveform' | 'classic';

/**
 * A DJ-mode marker within a track. As playback crosses `time`, the bar shows
 * the marker's title / artist / artwork / bpm / key in place of the track's.
 */
export interface WaveformBarMarker {
    /** Time in seconds. Markers without a finite time are dropped. */
    time: number;
    label?: string;
    title?: string;
    artist?: string;
    artwork?: string;
    bpm?: string | number;
    key?: string;
    /** Marker colour on the waveform. Defaults to the `markerColor` option. */
    color?: string;
}

/**
 * A queue entry. Only `url` is required; it is also the track's identity in
 * the queue. Extra caller-supplied fields are kept (they come back from
 * `getQueue()` and in callbacks and events).
 */
export interface WaveformBarTrack {
    url: string;
    /** Favourite / cart identity. Falls back to `url`. */
    id?: string;
    title?: string;
    artist?: string;
    artwork?: string;
    album?: string;
    /** Page the bar's track info links to. Only http(s) and relative URLs are followed. */
    link?: string;
    /**
     * The track's length: seconds (`187`) or a clock string (`'3:07'`,
     * `'1:02:03'`). Shown as a meta tag (seconds are shown as `3:07`) and as
     * the bar's total time, and passed to the player as its `duration`, a
     * known length used until the audio's own metadata arrives — so nothing
     * has to load for the length to show. Anything unparseable is only shown
     * as a tag.
     */
    duration?: string | number;
    bpm?: string | number;
    key?: string;
    /** Pre-computed peaks: an array, a compact `wp1:` string, or a URL / JSON string of them. */
    waveform?: number[] | string | null;
    markers?: WaveformBarMarker[];
    favorited?: boolean;
    inCart?: boolean;
    /** Extra meta tags, shown after bpm / key / duration up to `maxMeta`. */
    meta?: Record<string, unknown> | unknown[];
    [key: string]: unknown;
}

/** What a favourite / cart action sends to its endpoint (as the JSON body, or the callback's argument). */
export interface WaveformBarActionPayload {
    action: 'favorite' | 'cart';
    id: string;
    url: string;
    title?: string;
    /** Favourite actions only: the new state. */
    favorited?: boolean;
}

/**
 * A server-side action. `endpoint` is a URL that receives a `fetch()` with a
 * JSON body (default method POST), or a function called with the payload.
 */
export interface WaveformBarAction {
    endpoint: string | ((payload: WaveformBarActionPayload) => void);
    method?: string;
    headers?: Record<string, string>;
}

/** Favourite and cart actions. Each one present also adds its button to the bar. */
export interface WaveformBarActions {
    favorite?: WaveformBarAction;
    cart?: WaveformBarAction;
}

/** Options for `WaveformBar.init()`. Every key is optional. */
export interface WaveformBarConfig {
    // Persistence and behaviour
    /** Persist the queue, position, volume and favourites. @default true */
    persist?: boolean;
    /** Resume playback after a page load when it was playing. @default true */
    autoResume?: boolean;
    /** Advance to the next queued track when one ends. @default true */
    continuous?: boolean;
    /** @default 'off' */
    repeat?: WaveformBarRepeatMode;
    /** Random queue advance. @default false */
    shuffle?: boolean;

    // UI toggles
    /** @default true */
    showRepeat?: boolean;
    /** @default false */
    showShuffle?: boolean;
    /** @default true */
    showQueue?: boolean;
    /** @default true */
    showPrevNext?: boolean;
    /** @default true */
    showVolume?: boolean;
    /** @default true */
    showMute?: boolean;
    /** @default true */
    showMeta?: boolean;
    /** @default true */
    showTime?: boolean;
    /** @default true */
    showTrackLink?: boolean;
    /** @default 3 */
    maxMeta?: number;

    // Layout and docking
    /** Fallback artwork URL. @default null */
    defaultArtwork?: string | null;
    /** `null` auto-detects from the page. @default null */
    theme?: WaveformBarTheme | null;
    /** Full width instead of the 1400px cap (waveform mode only). @default false */
    wide?: boolean;
    /** @default 'bottom' */
    position?: 'bottom' | 'top';
    /** Show a button that collapses the bar to a floating pill. @default false */
    collapsible?: boolean;
    /** Not defaulted: inferred from `waveform` / `layout` when not given. @default 'waveform' */
    mode?: WaveformBarMode;
    /** Legacy: `'center'` means classic mode. Prefer `mode`. */
    layout?: 'default' | 'center';
    /** Legacy: `false` means classic mode. Prefer `mode`. @default true */
    waveform?: boolean;

    // Player strings (null = the player's default)
    /** Message shown when audio fails to load. @default null */
    errorText?: string | null;
    /** CORS mode for the embedded `<audio>`. `null` leaves it unset. @default null */
    crossOrigin?: 'anonymous' | 'use-credentials' | null;
    /** Seek slider `aria-valuetext` template: `%1$s` current, `%2$s` total. @default null */
    seekValueText?: string | null;
    /** @default null */
    playPauseLabel?: string | null;
    /** @default null */
    speedLabel?: string | null;
    /** @default null */
    artworkAlt?: string | null;
    /** Media Session title fallback. @default null */
    unknownTrackText?: string | null;

    // Sharing
    /** Show a "copy share link" button. @default false */
    share?: boolean;
    /** Query parameter carrying the shared timestamp (seconds). @default 'wt' */
    shareParam?: string;

    // Waveform
    /** @default 'mirror' */
    waveformStyle?: WaveformStyle;
    /** @default 32 */
    waveformHeight?: number;
    /** @default 2 */
    barWidth?: number;
    /** @default 2 */
    barSpacing?: number;
    /** Bar-cap radius in px (`0` is square). `null` = the player's default. @default null */
    barRadius?: number | null;
    /** A CSS colour, or colour stops for a gradient. `null` = theme default. @default null */
    waveformColor?: string | string[] | null;
    /** @default null */
    progressColor?: string | string[] | null;
    /** @default 'vertical' */
    waveformGradient?: 'vertical' | 'horizontal' | 'diagonal';
    /** @default 'rgba(255, 255, 255, 0.25)' */
    markerColor?: string;

    // Volume, storage, actions
    /** Initial volume, 0..1. @default 1 */
    volume?: number;
    /** Prefix of the storage keys. @default 'waveform-bar' */
    storageKey?: string;
    /** @default null */
    actions?: WaveformBarActions | null;

    // Callbacks (each also has a `waveformbar:*` DOM event)
    onPlay?: ((track: WaveformBarTrack | null) => void) | null;
    onPause?: ((track: WaveformBarTrack | null) => void) | null;
    onTrackChange?: ((track: WaveformBarTrack, index: number) => void) | null;
    onQueueChange?: ((queue: WaveformBarTrack[], currentIndex: number) => void) | null;
    onVolumeChange?: ((volume: number) => void) | null;
    onShuffleChange?: ((shuffle: boolean) => void) | null;
    onFavorite?: ((track: WaveformBarTrack, favorited: boolean) => void) | null;
    onCart?: ((track: WaveformBarTrack) => void) | null;
}

/** Every `waveformbar:*` event. They bubble from the bar element; listen on `document`. */
export interface WaveformBarEventMap {
    'waveformbar:play': CustomEvent<{track: WaveformBarTrack | null}>;
    'waveformbar:pause': CustomEvent<{track: WaveformBarTrack | null}>;
    'waveformbar:error': CustomEvent<{track: WaveformBarTrack | null}>;
    'waveformbar:trackchange': CustomEvent<{track: WaveformBarTrack; index: number}>;
    'waveformbar:queuechange': CustomEvent<{queue: WaveformBarTrack[]; currentIndex: number}>;
    'waveformbar:volumechange': CustomEvent<{volume: number}>;
    'waveformbar:favorite': CustomEvent<{track: WaveformBarTrack; favorited: boolean}>;
    'waveformbar:cart': CustomEvent<{track: WaveformBarTrack}>;
    'waveformbar:repeatchange': CustomEvent<{mode: WaveformBarRepeatMode}>;
    'waveformbar:shufflechange': CustomEvent<{shuffle: boolean}>;
    'waveformbar:markerchange': CustomEvent<{marker: WaveformBarMarker; index: number; track: WaveformBarTrack | null}>;
    'waveformbar:share': CustomEvent<{url: string; time: number; track: WaveformBarTrack | null}>;
    'waveformbar:collapse': CustomEvent<{collapsed: boolean}>;
}

/**
 * The config once `init()` has merged it over the defaults and derived `mode`,
 * `layout` and `waveform`. Not re-exported from the entry point.
 */
export type WaveformBarResolvedConfig = Required<WaveformBarConfig>;

/** What the bar keeps in sessionStorage. Not re-exported from the entry point. */
export interface WaveformBarQueueState {
    queue: WaveformBarTrack[];
    currentIndex: number;
    position: number;
    isPlaying: boolean;
}
