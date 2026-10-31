const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_OR_SPACE = /[\u0000- \u007f-\u009f]/;

/**
 * The URL rule: only `data:` images, `#` targets and relative in-app targets. Anything with another scheme,
 * a network-path (`//host`) or a backslash is refused, and so is any control character or space, because
 * browsers strip those before reading the scheme. An empty string means no URL and is allowed
 */
export function isSafeUrl(value: string): boolean {
    if (value === '') return true;
    if (/^data:/i.test(value)) return DATA_IMAGE.test(value) && !CONTROL.test(value);
    if (CONTROL_OR_SPACE.test(value) || value.includes('\\')) return false;
    if (value.startsWith('#')) return true;
    if (value.startsWith('//') || SCHEME.test(value)) return false;
    return true;
}
