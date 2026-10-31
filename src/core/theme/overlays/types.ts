import type { JsonObject } from '../../types.js';

/** The overlay kinds; a kind may touch only some token groups, so overlays stay small and cannot fight each other */
export const OVERLAY_KINDS = ['mode', 'brand', 'motion'] as const;

export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/** The token paths each kind may set: a path is allowed when it is one of these or below one of them */
export const KIND_GROUPS: Readonly<Record<OverlayKind, readonly string[]>> = {
    mode: ['color', 'elevation'],
    brand: ['palette', 'font.family', 'radius', 'icon'],
    motion: ['motion']
};

/** The value that makes `mode` or `motion` follow the browser; no overlay has this name */
export const SYSTEM = 'system';

/** The kinds whose active name may be `system` */
export const SYSTEM_KINDS: readonly OverlayKind[] = ['mode', 'motion'];

/** One overlay: a sparse token tree */
export interface TokenOverlay {
    tokens: JsonObject;
}

/** Overlays by kind and then by name */
export type ThemeOverlays = Readonly<Record<string, Readonly<Record<string, TokenOverlay>>>>;

export function isOverlayKind(kind: string): kind is OverlayKind {
    return (OVERLAY_KINDS as readonly string[]).includes(kind);
}
