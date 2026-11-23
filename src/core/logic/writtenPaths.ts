/** The paths logic reads and writes as written: the logic engine's own reading of them, beside @punyts/state's matcher */

/**
 * The steps of a written path (`$.data.bag.{id}.total`), with `null` for a step that is only known when it runs (a
 * capture, `*` or a `{{ }}` template)
 */
export function writeSteps(path: string): (string | null)[] {
    return path
        .replace(/\{\{[\s\S]*?\}\}/g, '{}')
        .slice(2)
        .split('.')
        .map((step) => (step === '*' || step.includes('{') ? null : step));
}

const EXPRESSION_PATH = /\$\.(?:[A-Za-z0-9_-]+|\{[A-Za-z_][A-Za-z0-9_]*\}|\*)(?:\.(?:[A-Za-z0-9_-]+|\{[A-Za-z_][A-Za-z0-9_]*\}|\*))*/g;

/** The state paths an expression reads (`$.data.cart`, `$.data.lines.{id}.qty`), as written */
export function expressionPaths(text: string): string[] {
    return [...new Set([...text.matchAll(EXPRESSION_PATH)].map((match) => match[0]))];
}
