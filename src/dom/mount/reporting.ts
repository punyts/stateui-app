import { addListener, consoleLogger, getCategories, setCategories } from '@punyts/core';

/** The `localStorage` key that lists the report categories to turn on in the browser, comma-separated */
export const REPORT_STORAGE_KEY = 'punyts.report';

let started = false;

/** The categories a stored list names, trimmed, without empty entries */
function parseCategories(text: string | null): string[] {
    if (text === null) return [];
    return [...new Set(text.split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''))];
}

/**
 * The browser host's reporting, once per page: reads `localStorage['punyts.report']` (`stateui-app.*,state.set`) and,
 * when it names categories, adds them to the reporter's current ones and logs their reports to the console with
 * `consoleLogger`. Reading storage may throw (a private window, a sandboxed frame of opaque origin): then nothing is
 * turned on. Returns the categories it turned on; none after the first call on a page
 */
export function startBrowserReporting(): string[] {
    if (started) return [];
    started = true;
    let text: string | null;
    try {
        text = globalThis.localStorage?.getItem(REPORT_STORAGE_KEY) ?? null;
    } catch {
        return [];
    }
    const categories = parseCategories(text);
    if (categories.length === 0) return [];
    setCategories([...new Set([...getCategories(), ...categories])]);
    addListener(consoleLogger, categories);
    return categories;
}
