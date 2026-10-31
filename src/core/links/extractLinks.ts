import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import type { ExtractOptions, ExtractResult, Link, RowLinkOptions } from './types.js';

const ROOT_PATH = '$.app';
const SEGMENT = '[A-Za-z0-9_-]+';
const DATA_TARGET = new RegExp(`^\\$\\.data(\\.${SEGMENT})*$`);
const ROW_TARGET = new RegExp(`^\\$row(\\.${SEGMENT})*$`);
const NODE_REFERENCE = new RegExp(`^(\\^${SEGMENT}|)(\\.${SEGMENT})+$`);

/** True for a target a link may have: `$.data`, `$row`, or a node reference (`^name.path`, `.path`) */
function isLinkTarget(target: string): boolean {
    return DATA_TARGET.test(target) || ROW_TARGET.test(target) || NODE_REFERENCE.test(target);
}

class Extractor {
    readonly links: Link[] = [];
    readonly errors: BuildError[] = [];

    /** Copies a value, removing every `<-` property and recording it. `on` entries are left as written */
    walk(value: JsonValue, path: string): JsonValue {
        if (Array.isArray(value)) return value.map((item, index) => this.walk(item, `${path}.${index}`));
        if (!isObject(value)) return value;

        const copy: JsonObject = {};
        for (const [key, item] of Object.entries(value)) {
            if (key.startsWith(PREFIXES.link)) {
                this.record(path, key.slice(PREFIXES.link.length), item);
            } else if (key === RESERVED_KEYS.on) {
                copy[key] = item;
            } else {
                copy[key] = this.walk(item, `${path}.${key}`);
            }
        }
        return copy;
    }

    private record(path: string, key: string, target: JsonValue): void {
        if (key === '') {
            this.errors.push(buildError('SUI-NODE-NAME', { name: PREFIXES.link, path, statePath: path }));
            return;
        }
        if (typeof target !== 'string' || !isLinkTarget(target)) {
            const shown = typeof target === 'string' ? target : `(${target === null ? 'null' : typeof target})`;
            this.errors.push(buildError('SUI-LINK-TARGET', { key, target: shown, path, statePath: path }));
            return;
        }
        this.links.push({ statePath: path, key, target });
    }
}

/**
 * Collects every `<-key` property of a resolved tree and returns the tree without them. A target must start
 * with `$.data` or `$row`, or be a node reference (`^name.path`, `.path`) to an exposed runtime property;
 * anything else is `SUI-LINK-TARGET`. Node references and `$row` targets are returned as written: E2.13 and
 * `resolveRowLinks` turn them into store paths before `applyLinks`. Pure; never throws on a bad tree
 */
export function extractLinks(resolvedTree: Node, options: ExtractOptions = {}): ExtractResult {
    const extractor = new Extractor();
    const tree = extractor.walk(resolvedTree, options.path ?? ROOT_PATH) as Node;
    return {
        tree,
        links: extractor.links,
        linkedPaths: extractor.links.map((link) => `${link.statePath}.${link.key}`),
        errors: extractor.errors
    };
}

/**
 * The links of one record-view slot. `$row` targets are rewritten to the slot's `row` alias path, so with
 * `rowPath` `$.runtime.nodes.app.orders.slots.3.row` the target `$row.customer` becomes
 * `$.runtime.nodes.app.orders.slots.3.row.customer`. Those links are fixed aliases created once per slot with
 * `allowMissing`: a missing field reads as `undefined` and updates when it appears. Only `row` is ever
 * re-pointed. Other targets are returned as written
 */
export function resolveRowLinks(rowNode: Node, rowPath: string, options: RowLinkOptions = {}): ExtractResult {
    const result = extractLinks(rowNode, { path: options.path ?? rowPath.slice(0, rowPath.lastIndexOf('.')) });
    const links = result.links.map((link): Link => {
        if (!ROW_TARGET.test(link.target)) return link;
        return { ...link, target: `${rowPath}${link.target.slice('$row'.length)}`, allowMissing: true };
    });
    return { ...result, links };
}
