/*
 * Closed limits of the runtime protocol. A message over its limit is dropped and counted, never truncated.
 * The sizes are serialised JSON in UTF-8 bytes
 */

/** Longest nonce, in characters */
export const MAX_NONCE_LENGTH = 128;

/** Longest change id, in characters */
export const MAX_CHANGE_ID_LENGTH = 128;

/** Largest `load`: a document (1 MiB), its data snapshot (512 KiB), articulation and icons, with room for the envelope */
export const MAX_LOAD_BYTES = 3 * 1024 * 1024;

/** Largest `write` message */
export const MAX_WRITE_BYTES = 512 * 1024;

/** Largest `change`: one value, as large as a whole `write` */
export const MAX_CHANGE_BYTES = MAX_WRITE_BYTES;

/** Largest `emit`, `error`, `command` and `event` message */
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

/** Largest file a component can hand to the host: the `data` buffer of a `file` message (10 MiB) */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Largest JSON part of `file`, `fileCancel`, `fileProgress` and `fileResult` (the `data` buffer is not counted) */
export const MAX_FILE_JSON_BYTES = 2 * 1024;

/** Longest file name, in characters */
export const MAX_FILE_NAME_LENGTH = 255;

/** Longest media type, in characters */
export const MAX_FILE_TYPE_LENGTH = 127;

/** Longest file id, in characters */
export const MAX_FILE_ID_LENGTH = 128;

/** How long `transferFile` waits for the host, in milliseconds: with no `fileProgress` or `fileResult` for this long it rejects with `offline` */
export const FILE_IDLE_TIMEOUT_MS = 120_000;

/** The byte limit of each message type */
export const MESSAGE_BYTE_LIMITS = {
    load: MAX_LOAD_BYTES,
    write: MAX_WRITE_BYTES,
    command: MAX_EVENT_BYTES,
    locale: MAX_SMALL_BYTES,
    theme: MAX_SMALL_BYTES,
    event: MAX_EVENT_BYTES,
    ready: MAX_SMALL_BYTES,
    change: MAX_CHANGE_BYTES,
    emit: MAX_EVENT_BYTES,
    error: MAX_EVENT_BYTES,
    ping: MAX_SMALL_BYTES,
    pong: MAX_SMALL_BYTES,
    file: MAX_FILE_JSON_BYTES,
    fileCancel: MAX_FILE_JSON_BYTES,
    fileProgress: MAX_FILE_JSON_BYTES,
    fileResult: MAX_FILE_JSON_BYTES
} as const;
