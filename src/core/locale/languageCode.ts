/**
 * A language code: a primary subtag of 2 or 3 lowercase letters, then any number of subtags of 2 to 8 letters or
 * digits (`de`, `pt-BR`, `zh-Hant-TW`). The one pattern the blueprint reader, the document check, the runtime protocol,
 * `scanLibrary` and the tools judge a language by
 */
export const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Whether `value` is text that matches `LANGUAGE_CODE` */
export function isLanguageCode(value: unknown): value is string {
    return typeof value === 'string' && LANGUAGE_CODE.test(value);
}
