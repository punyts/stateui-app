/**
 * The URLs of an app's files on the `/paths` route (docs/design/statenet-paths-route.md, "The frame's side"). The host's
 * `load` names where the app's files are read (`files.url`) and the read grant the frame appends (`files.grant`); a
 * `grant` message replaces the grant before it runs out. The runtime frame's requests carry no cookie, so a file URL
 * carries the grant as `?g=`
 */

/** The longest read grant the runtime holds, the same bound the server checks (a signed grant token, `PathTokens` in stateui-mcp) */
export const MAX_GRANT_LENGTH = 4096;

/** The longest `files.url` of a `load` */
export const MAX_FILES_URL_LENGTH = 512;

/** A read grant: two base64url parts joined by a dot, the signed body and its mac */
const GRANT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** A file id: the UUID the server gives every stored file */
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where an app's files are read, as a `load` gives it */
export interface FilesSource {
    /** The absolute URL of the app's files, such as `https://host/paths/<owner>/apps/<app>/files` */
    url: string;
    /** The read grant appended to each file URL; absent where the reader needs none */
    grant?: string;
}

/** Gives the URL of a stored file by its id, or undefined when the runtime cannot read it there */
export type FileUrl = (id: string) => string | undefined;

/** True when `value` has the shape of a read grant */
export function isGrant(value: unknown): value is string {
    return typeof value === 'string' && value.length <= MAX_GRANT_LENGTH && GRANT.test(value);
}

/** True when `value` is an `http:` or `https:` URL with no credentials, query or fragment */
export function isFilesUrl(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > MAX_FILES_URL_LENGTH) return false;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === '' && url.search === '' && url.hash === '' && !value.includes('?') && !value.includes('#');
}

/** True when `value` is a `FilesSource` the runtime takes: only `url` and `grant`, each of its shape */
export function isFilesSource(value: unknown): value is FilesSource {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    if (!Object.keys(entry).every((key) => key === 'url' || key === 'grant')) return false;
    return isFilesUrl(entry['url']) && (entry['grant'] === undefined || isGrant(entry['grant']));
}

export interface FileUrls {
    fileUrl: FileUrl;
    /** Sets where the files are read, from a `load`; undefined when the host names none */
    set(source: FilesSource | undefined): void;
    /** Replaces the grant, from a `grant` message; ignored while the runtime knows no files URL */
    grant(grant: string): void;
}

/** The file URLs of a runtime: the files URL and the grant the host gave last */
export function createFileUrls(): FileUrls {
    let base: string | undefined;
    let current: string | undefined;
    return {
        fileUrl(id) {
            if (base === undefined || !FILE_ID.test(id)) return undefined;
            return `${base}/${id.toLowerCase()}${current === undefined ? '' : `?g=${current}`}`;
        },
        set(source) {
            base = source?.url.replace(/\/+$/, '');
            current = source?.grant;
        },
        grant(grant) {
            if (base !== undefined) current = grant;
        }
    };
}
