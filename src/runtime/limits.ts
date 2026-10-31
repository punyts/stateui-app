/*
 * Closed limits of the runtime protocol. A message over its limit is dropped and counted, never truncated.
 * The sizes are serialised JSON in UTF-8 bytes
 */

/** Longest nonce, in characters */
export const MAX_NONCE_LENGTH = 128;

/** Largest `load`: a document (1 MiB), its data snapshot (512 KiB), articulation and icons, with room for the envelope */
export const MAX_LOAD_BYTES = 3 * 1024 * 1024;

/** Largest `write` message */
export const MAX_WRITE_BYTES = 512 * 1024;

/** Largest `snapshot`: the data (512 KiB) and the articulation values */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/** Largest `emit`, `error` and `command` message */
export const MAX_EVENT_BYTES = 64 * 1024;

/** Largest message of the small types: `locale`, `theme`, `ready`, `ping`, `pong` */
export const MAX_SMALL_BYTES = 1024;

/** Most path writes in one `write` message */
export const MAX_WRITES = 500;

/** Longest state path of a write, in characters */
export const MAX_PATH_LENGTH = 512;

/** Most errors in one `error` message */
export const MAX_ERRORS = 50;

/** Longest text of one error field, in characters */
export const MAX_ERROR_TEXT = 1000;

/** Longest event name, command name, locale code, theme kind and theme name, in characters */
export const MAX_NAME_LENGTH = 64;

/** Most icons in one icons map */
export const MAX_ICONS = 256;

/** Most paths of one icon variant */
export const MAX_ICON_PATHS = 32;

/** Longest path data string, in characters */
export const MAX_ICON_PATH_LENGTH = 8 * 1024;

/** Largest icons map, serialised, in UTF-8 bytes */
export const MAX_ICONS_BYTES = 256 * 1024;

/** The byte limit of each message type */
export const MESSAGE_BYTE_LIMITS = {
    load: MAX_LOAD_BYTES,
    write: MAX_WRITE_BYTES,
    command: MAX_EVENT_BYTES,
    locale: MAX_SMALL_BYTES,
    theme: MAX_SMALL_BYTES,
    ready: MAX_SMALL_BYTES,
    snapshot: MAX_SNAPSHOT_BYTES,
    emit: MAX_EVENT_BYTES,
    error: MAX_EVENT_BYTES,
    ping: MAX_SMALL_BYTES,
    pong: MAX_SMALL_BYTES
} as const;
