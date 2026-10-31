/**
 * Blanks everything in CSS text that is not code: comments, the inside of strings and the inside of `url(...)`.
 * Every blanked character becomes a space and newlines stay, so an offset in the result is the offset in the source
 */
export function maskCss(css: string): string {
    let out = '';
    let index = 0;
    const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
    while (index < css.length) {
        const char = css[index] as string;
        if (css.startsWith('/*', index)) {
            const end = css.indexOf('*/', index + 2);
            const stop = end === -1 ? css.length : end + 2;
            out += blank(css.slice(index, stop));
            index = stop;
        } else if (char === '"' || char === "'") {
            let stop = index + 1;
            while (stop < css.length && css[stop] !== char && css[stop] !== '\n') stop += css[stop] === '\\' ? 2 : 1;
            stop = Math.min(stop, css.length);
            out += char + blank(css.slice(index + 1, stop));
            if (stop < css.length && css[stop] === char) out += char;
            index = stop + 1;
        } else if (/^url\(/i.test(css.slice(index, index + 4))) {
            const end = css.indexOf(')', index);
            const stop = end === -1 ? css.length : end;
            out += css.slice(index, index + 4) + blank(css.slice(index + 4, stop));
            index = stop;
        } else {
            out += char;
            index += 1;
        }
    }
    return out;
}

/** One declaration of masked CSS: where its property name, colon and value start, and where it ends */
export interface Declaration {
    property: string;
    /** Offset of the first character after the colon */
    valueStart: number;
    /** Offset of the terminating `;` or `}`, or the end of the text */
    end: number;
}

/**
 * The declarations of masked CSS: every run of text that ends in `;` or `}` (or the end) and holds a colon after a
 * property name. A run that ends in `{` is a selector or an at-rule prelude and is skipped
 */
export function declarationsOf(masked: string): Declaration[] {
    const found: Declaration[] = [];
    let start = 0;
    const take = (end: number): void => {
        const text = masked.slice(start, end);
        const colon = text.indexOf(':');
        if (colon === -1) return;
        const property = text.slice(0, colon).trim();
        if (/^(?:--)?[a-zA-Z][a-zA-Z0-9-]*$/.test(property)) found.push({ property, valueStart: start + colon + 1, end });
    };
    for (let index = 0; index < masked.length; index += 1) {
        const char = masked[index];
        if (char === ';' || char === '}') {
            take(index);
            start = index + 1;
        } else if (char === '{') start = index + 1;
    }
    take(masked.length);
    return found;
}

/** Turns offsets into 1-based line and column numbers */
export function locator(text: string): (offset: number) => { line: number; column: number } {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') starts.push(index + 1);
    return (offset) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if ((starts[mid] as number) <= offset) low = mid;
            else high = mid - 1;
        }
        return { line: low + 1, column: offset - (starts[low] as number) + 1 };
    };
}
