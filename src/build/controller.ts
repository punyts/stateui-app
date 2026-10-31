import ts from 'typescript';
import type { BuildError } from '../core/errors/index.js';
import { buildFailure } from './failures.js';

export interface ControllerResult {
    /** The JavaScript for the controller, when it has no errors */
    js?: string;
    errors: BuildError[];
}

function isExported(node: ts.Node): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** A controller exports one factory, as its default export, and nothing else */
function exportErrors(source: ts.SourceFile, file: string): BuildError[] {
    let defaults = 0;
    let others = 0;
    for (const statement of source.statements) {
        if (ts.isExportAssignment(statement)) {
            defaults++;
        } else if (ts.isExportDeclaration(statement)) {
            const names = statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements : [];
            if (statement.isTypeOnly) continue;
            const only = names.filter((element) => !element.isTypeOnly);
            const asDefault = only.filter((element) => element.name.text === 'default').length;
            defaults += asDefault;
            others += statement.exportClause ? only.length - asDefault : 1;
        } else if (isExported(statement)) {
            const isDefault = (ts.getModifiers(statement as ts.HasModifiers) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
            if (isDefault) defaults++;
            else if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) others++;
        }
    }

    if (defaults === 1 && others === 0) return [];
    return [buildFailure('controller', file, 'must export one factory as its default export and nothing else')];
}

/** Checks a `controller.ts` and transpiles it to an ES module. It is never run, and it is not type-checked against the component */
export function compileController(text: string, file: string): ControllerResult {
    const output = ts.transpileModule(text, {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            newLine: ts.NewLineKind.LineFeed,
            sourceMap: false,
            inlineSourceMap: false,
            removeComments: false
        }
    });

    const errors: BuildError[] = [];
    for (const diagnostic of output.diagnostics ?? []) {
        let line: number | undefined;
        let column: number | undefined;
        if (diagnostic.file && diagnostic.start !== undefined) {
            const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            line = position.line + 1;
            column = position.character + 1;
        }
        errors.push(buildFailure('controller', file, ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '), line, column));
    }

    if (errors.length > 0) return { errors };
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    errors.push(...exportErrors(source, file));
    return errors.length > 0 ? { errors } : { js: output.outputText, errors };
}
