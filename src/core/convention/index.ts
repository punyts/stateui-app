export { scanLibrary } from './scanLibrary.js';
export type { ScanResult } from './scanLibrary.js';
export type { ComponentFiles, ComponentTier, FileMap, ScannedComponent } from './types.js';
export { checkComposedExposes, checkExposes, exposedPathResolves, EXPOSES_KEY, parseComposed, withoutExposes } from './composed.js';
export type { ExposedPath, ExposesIssue, ParsedComposed } from './composed.js';
