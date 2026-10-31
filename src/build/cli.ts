#!/usr/bin/env node
import { buildLibrary } from './buildLibrary.js';
import { formatError } from './format.js';

const [sourceDir, outDir, ...rest] = process.argv.slice(2);
if (!sourceDir || !outDir || rest.length > 0) {
    process.stderr.write('Usage: stateui-app-build <sourceDir> <outDir>\n');
    process.exit(2);
}

const result = await buildLibrary(sourceDir, outDir);
for (const error of result.errors) process.stderr.write(`${formatError(error)}\n`);
const count = result.built.length;
process.stdout.write(`Built ${count} component${count === 1 ? '' : 's'} into ${outDir}\n`);
process.exit(result.errors.some((error) => error.severity !== 'warning') ? 1 : 0);
