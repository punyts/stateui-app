/** The attribute `mountApp` puts on its host, which the page sheet keys on */
export const APP_HOST_ATTRIBUTE = 'sui-app';

/**
 * The page sheet: an app on the page's body, or on an element right below it, fills the viewport, and two or more
 * apps there share its width in equal columns, each at least the viewport's height (the page scrolls when an app is
 * taller). The body loses its margin and becomes a grid of one row and a column per element (apps on the body itself
 * are its items). A grid stretches only an item's auto width and height, so a host the page gives a size keeps it, and
 * the app component below its `display: contents` root fills its cell. Every selector is in `:where()`, so a page
 * that lays out its own body wins. An app deeper in the page is sized by the page
 */
export const PAGE_SHEET = `:where(:root:has(> body[${APP_HOST_ATTRIBUTE}], > body > [${APP_HOST_ATTRIBUTE}])) { block-size: 100%; }
:where(body[${APP_HOST_ATTRIBUTE}], body:has(> [${APP_HOST_ATTRIBUTE}])) {
    margin: 0;
    min-block-size: 100%;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
}
:where(body > [${APP_HOST_ATTRIBUTE}]) { display: grid; min-inline-size: 0; }
`;

/** The documents the sheet is adopted by, so each adopts it once */
const adopted = new WeakSet<Document>();

/** The apps mounted on each host, so the mark stays until the last of them is disposed */
const mounted = new WeakMap<Element, number>();

/**
 * Marks `host` as an app's host and adopts the page sheet in its document (a constructed sheet, which a content
 * security policy without inline styles allows). Returns the function that takes the mark off once no other app is
 * mounted on `host`; the sheet stays, since it matches nothing without a mark
 */
export function fillPage(host: Element): () => void {
    const page = host.ownerDocument;
    if (!adopted.has(page) && typeof CSSStyleSheet === 'function' && Array.isArray(page.adoptedStyleSheets)) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(PAGE_SHEET);
        page.adoptedStyleSheets = [...page.adoptedStyleSheets, sheet];
        adopted.add(page);
    }
    mounted.set(host, (mounted.get(host) ?? 0) + 1);
    host.setAttribute(APP_HOST_ATTRIBUTE, '');
    let done = false;
    return () => {
        if (done) return;
        done = true;
        const left = (mounted.get(host) ?? 1) - 1;
        mounted.set(host, left);
        if (left === 0) host.removeAttribute(APP_HOST_ATTRIBUTE);
    };
}
