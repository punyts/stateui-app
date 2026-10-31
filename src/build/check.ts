import type { BuildError } from '../core/errors/index.js';
import type { StateUIModule } from './dom.js';
import { buildFailure } from './failures.js';

let checkCounter = 0;

/**
 * Compiles a template and stylesheet with StateUI the way `defineComponent` does, under a throwaway tag so the
 * real tag stays free. Parse, compile and style errors become `SUI-BUILD` errors with the file, line and column
 */
export function compileCheck(
    stateui: StateUIModule,
    template: { file: string; text: string },
    styles: { file: string; text: string } | undefined
): BuildError[] {
    const errors: BuildError[] = [];
    const tag = `sui-build-check-${++checkCounter}`;
    try {
        stateui.defineComponent({ tag, template: template.text });
    } catch (error) {
        errors.push(describe(stateui, error, template.file, 'template'));
    }

    if (styles) {
        try {
            stateui.defineComponent({ tag: `${tag}-styles`, template: '<slot></slot>', styles: styles.text });
        } catch (error) {
            errors.push(describe(stateui, error, styles.file, 'styles'));
        }
    }

    return errors;
}

function describe(stateui: StateUIModule, error: unknown, file: string, part: 'template' | 'styles'): BuildError {
    if (error instanceof stateui.TemplateParseError) {
        return buildFailure(part, file, error.message, error.line, error.column);
    }
    if (error instanceof stateui.TemplateCompileError) {
        return buildFailure(part, file, error.message, error.line);
    }
    if (error instanceof stateui.StyleCompileError) {
        return buildFailure(part, file, error.message.replace(/ \(line \d+\)$/, ''), error.line);
    }
    return buildFailure(part, file, error instanceof Error ? error.message : 'unknown error');
}

