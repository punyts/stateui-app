/** One `var(--ui-...)` in masked CSS */
export interface UiVar {
    /** The custom property name, such as `--ui-button-radius` */
    name: string;
    /** Offset of the name */
    nameOffset: number;
    /** Offset of `var(` */
    start: number;
    /** Offset just after the closing `)` */
    end: number;
    /** The text after the first comma, up to the closing parenthesis; undefined for a bare `var(--ui-x)` */
    fallback?: string;
}

const UI_VAR = /var\(\s*(--ui-[a-z0-9-]*)/g;

/** The offset just after the `)` that closes the one opened before `from`; the text end when it never closes */
function closeOf(text: string, from: number): number {
    let depth = 1;
    for (let index = from; index < text.length; index += 1) {
        if (text[index] === '(') depth += 1;
        else if (text[index] === ')') {
            depth -= 1;
            if (depth === 0) return index + 1;
        }
    }
    return text.length;
}

/** Every `var(--ui-...)` in masked CSS, nested ones included, in source order */
export function findUiVars(masked: string): UiVar[] {
    const vars: UiVar[] = [];
    for (const match of masked.matchAll(UI_VAR)) {
        const start = match.index ?? 0;
        const name = match[1] as string;
        const nameOffset = start + match[0].length - name.length;
        const end = closeOf(masked, start + 4);
        const inner = masked.slice(nameOffset + name.length, end - 1);
        const comma = inner.indexOf(',');
        vars.push({ name, nameOffset, start, end, ...(comma === -1 ? {} : { fallback: inner.slice(comma + 1) }) });
    }
    return vars;
}

/** Removes all whitespace, so two spellings of one expression compare equal */
export function squash(text: string): string {
    return text.replace(/\s+/g, '');
}
