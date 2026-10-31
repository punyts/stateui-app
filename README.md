# @punyts/stateui-app

Component system and app documents built on `@punyts/stateui`.

## Entry points
- `@punyts/stateui-app`: everything.
- `@punyts/stateui-app/core`: the DOM-free part; safe to import under plain Node.

## Error catalog, types and limits
All of it lives in `src/core/` and is exported from `@punyts/stateui-app/core`.

- **Error catalog.** `ERROR_CATALOG` owns every stable code (`SUI-DOC`, `SUI-NODE`, `SUI-STATE`, `SUI-LINK`, `SUI-ON`, `SUI-LAYOUT`, `SUI-THEME`, `SUI-LOCALE`, `SUI-BUILD`, `SUI-RUN` families) and its message template. `buildError(code, details)` returns a plain, serialisable `{ code, message, severity?, statePath?, component?, file?, line?, column? }`. `severity` is `"error"` (the default when absent) or `"warning"`; `isValid(errors)` ignores warnings. Templates take paths and names only (see `TEMPLATE_PLACEHOLDERS`), never content or data values.
- **Types.** `AppDocument` (`theme`, `themes`, `locale`, `data`, `app`, `composed`, `locales`), `Node`, and the reserved vocabulary as constants: `RESERVED_KEYS` (`component`, `children`, `layout`, `placement`, `theme`, `on`) and `PREFIXES` (`_`, `<-`, `__`).
- **Limits.** `checkLimits(document)` returns `SUI-DOC` errors for a document over `MAX_NODES` (2000, across `app` and every composed tree), `MAX_DEPTH` (32 node levels), `MAX_DOCUMENT_BYTES` (1 MiB) or `MAX_DATA_BYTES` (512 KiB, the `data` branch). The design names the limits without numbers; these values are the library's choice. A byte breach skips the node walk.

## Shape format
A component's `*.state.json` is its default state, its validation rules and its catalog entry. Code is in `src/core/shape/`, exported from `@punyts/stateui-app/core`.

```json
{
    "summary": "A text input with a label",
    "layout": false,
    "events": ["change", "invalid"],
    "commands": ["focus", "clear"],
    "properties": {
        "_label": { "type": "string", "kind": "content", "default": "Label" },
        "size": { "type": "string", "values": ["s", "m", "l"], "default": "m" },
        "value": { "type": "string", "required": true, "validators": { "length": { "max": 40 } } },
        "header": { "type": "node" },
        "src": { "type": "url" }
    }
}
```

- **Top-level keys.** `summary` (required; one line, at most `MAX_SUMMARY_LENGTH` = 120 characters; served by `ui_components_list`), `properties`, `events` and `commands` (lists of lower camel-case names), `layout` (true when the component lays out children, so a node may carry `layout`). Keys are rows in the `SHAPE_KEYS` table (and `PROPERTY_KEYS` for a property): name, JSON type and rule. A later story adds `shared`, `tokens` or `placement` by adding a row.
- **Property keys.** `type` (required: `string`, `number`, `integer`, `boolean`, `array`, `object`, `any`, `url`, `icon`, `node`, `map`, or a list of them when several are allowed, as in `["array", "map"]`), `default`, `required`, `kind` (`content` is the only extra kind), `values` (allowed values), `validators`, `items`, `requiredWhen`, `runtime`, `reflect`, `row`. A `node` property is a slot and must hold an object with a `component` name.
- **Maps (`type: "map"`, `items`).** `items` is `"string"` (every value is a string, e.g. a `_errors` content map) or a sub-shape: an object of properties each map value may hold (table `columns`, static `select` options). A map type needs `items` and no other type may have it. Nested `_` properties inside `items` must be kind `content` and every other nested property must not (`SUI-BUILD-KIND`). `validateNode` walks maps and reports each violation with the map key in the path, e.g. `$.app.children.t.columns.total._title`.
- **`requiredWhen`.** `{ "property": "decorative", "equals": false }` or `{ "property": "iconPosition", "notEquals": "start" }` makes the property required while a sibling property (same table, not itself) has, or does not have, that value. The sibling's value is the node's value or its default; if the sibling or the property is a `<-` link the check is skipped. A missing value is `SUI-STATE-CONDITION`, naming both properties.
- **`runtime: true`.** Only controllers write the property (`error`, `touched`, `status`). It needs a `default`, cannot be `required` and cannot sit inside map items. A node that sets it, by value or by `<-` link, is `SUI-STATE-RUNTIME`. The flag is on `PropertyShape.runtime` for the catalog.
- **`reflect: true`.** `<sui-node>` writes the property as a host attribute. Not allowed on `node`, `array`, `object`, `map` or `any`, or inside map items. `reflectedProperties(shape)` returns the names in shape order; it is the only source of the `reflect(componentName)` list the application gives `<sui-node>`.
- **`icon` type.** The value is an icon name: lower-case letters, digits and `-` (the empty string means no icon). `validateNode(shape, node, statePath, { isIconName })` also asks the caller's function (the server reads `icons.json`) and reports a rejected name as `SUI-STATE-INVALID`; without it the core knows no icon list.
- **`row: true`.** Marks a `node` property, or a `node` field of a map item (table column `cell`, `descriptionList` item `node`), as a row template where `$row` links and `$row` `on` targets are legal. `validateNode` reports `$row` in a `<-` link or `on` entry of the node, or inside a slot value that is not a row property, as `SUI-LINK-ROW`. The tree walker calls `validateNode` on a template node itself with `{ insideRow: true }`, which turns the check off.
- **Names.** A `_` name must have kind `content` and the reverse (`SUI-BUILD-KIND`). Names starting with `<-`, `$` or `__`, names that are not letters and digits, and the keys `component`, `layout`, `placement`, `theme` and `on` are `SUI-BUILD-NAME`.
- **Validators** (a closed set, in `VALIDATORS`): `oneOf` (a list of values), `pattern` (a regular expression of at most `MAX_PATTERN_LENGTH` = 200 characters; strings over `MAX_PATTERN_INPUT` = 10000 characters fail it), `range` and `length` (`{ "min": n, "max": n }`, either bound optional; `length` takes non-negative integers). An unknown validator is `SUI-BUILD-VALIDATOR`; options that are malformed or do not apply to the type are `SUI-BUILD-SHAPE`.
- **URL rule.** A `url` property accepts only `data:` images (`png`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `svg+xml`), `#` targets and relative targets. Other schemes, `//host`, backslashes, spaces and control characters are refused.
- **`parseShape(json, file)`** takes the file text or a parsed value and returns `{ shape, errors }`. It reports every problem (unknown keys are `SUI-BUILD-KEY`, a missing or bad summary is `SUI-BUILD-SUMMARY`, a default that does not fit is `SUI-BUILD-DEFAULT`, a bad pattern is `SUI-BUILD-PATTERN`) with the file; `shape` is set only when there are none.
- **`buildDefaults(shape)`** returns a fresh default state: every property that has a `default`.
- **`validateNode(shape, node, statePath)`** returns `SUI-STATE-*` violations with the state path: `SUI-STATE-UNKNOWN` (unknown property, a link to one, or `layout` on a component without it), `SUI-STATE-REQUIRED`, `SUI-STATE-INVALID` (type, allowed values, validators, URL rule, icon name, slot not a node, map contents), `SUI-STATE-CONDITION`, `SUI-STATE-RUNTIME`, `SUI-LINK-ROW` and `SUI-NODE-NAME` (`# @punyts/stateui-app

Component system and app documents built on `@punyts/stateui`.

## Entry points
- `@punyts/stateui-app`: everything.
- `@punyts/stateui-app/core`: the DOM-free part; safe to import under plain Node.

## Error catalog, types and limits
All of it lives in `src/core/` and is exported from `@punyts/stateui-app/core`.

- **Error catalog.** `ERROR_CATALOG` owns every stable code (`SUI-DOC`, `SUI-NODE`, `SUI-STATE`, `SUI-LINK`, `SUI-ON`, `SUI-LAYOUT`, `SUI-THEME`, `SUI-LOCALE`, `SUI-BUILD`, `SUI-RUN` families) and its message template. `buildError(code, details)` returns a plain, serialisable `{ code, message, severity?, statePath?, component?, file?, line?, column? }`. `severity` is `"error"` (the default when absent) or `"warning"`; `isValid(errors)` ignores warnings. Templates take paths and names only (see `TEMPLATE_PLACEHOLDERS`), never content or data values.
- **Types.** `AppDocument` (`theme`, `themes`, `locale`, `data`, `app`, `composed`, `locales`), `Node`, and the reserved vocabulary as constants: `RESERVED_KEYS` (`component`, `children`, `layout`, `placement`, `theme`, `on`) and `PREFIXES` (`_`, `<-`, `__`).
- **Limits.** `checkLimits(document)` returns `SUI-DOC` errors for a document over `MAX_NODES` (2000, across `app` and every composed tree), `MAX_DEPTH` (32 node levels), `MAX_DOCUMENT_BYTES` (1 MiB) or `MAX_DATA_BYTES` (512 KiB, the `data` branch). The design names the limits without numbers; these values are the library's choice. A byte breach skips the node walk.

## Shape format
A component's `*.state.json` is its default state, its validation rules and its catalog entry. Code is in `src/core/shape/`, exported from `@punyts/stateui-app/core`.

```json
{
    "summary": "A text input with a label",
    "layout": false,
    "events": ["change", "invalid"],
    "commands": ["focus", "clear"],
    "properties": {
        "_label": { "type": "string", "kind": "content", "default": "Label" },
        "size": { "type": "string", "values": ["s", "m", "l"], "default": "m" },
        "value": { "type": "string", "required": true, "validators": { "length": { "max": 40 } } },
        "header": { "type": "node" },
        "src": { "type": "url" }
    }
}
```

- **Top-level keys.** `summary` (required; one line, at most `MAX_SUMMARY_LENGTH` = 120 characters; served by `ui_components_list`), `properties`, `events` and `commands` (lists of lower camel-case names), `layout` (true when the component lays out children, so a node may carry `layout`). Keys are rows in the `SHAPE_KEYS` table (and `PROPERTY_KEYS` for a property): name, JSON type and rule. A later story adds `shared`, `tokens` or `placement` by adding a row.
- **Property keys.** `type` (required: `string`, `number`, `integer`, `boolean`, `array`, `object`, `any`, `url`, `icon`, `node`, `map`, or a list of them when several are allowed, as in `["array", "map"]`), `default`, `required`, `kind` (`content` is the only extra kind), `values` (allowed values), `validators`, `items`, `requiredWhen`, `runtime`, `reflect`, `row`. A `node` property is a slot and must hold an object with a `component` name.
- **Maps (`type: "map"`, `items`).** `items` is `"string"` (every value is a string, e.g. a `_errors` content map) or a sub-shape: an object of properties each map value may hold (table `columns`, static `select` options). A map type needs `items` and no other type may have it. Nested `_` properties inside `items` must be kind `content` and every other nested property must not (`SUI-BUILD-KIND`). `validateNode` walks maps and reports each violation with the map key in the path, e.g. `$.app.children.t.columns.total._title`.
- **`requiredWhen`.** `{ "property": "decorative", "equals": false }` or `{ "property": "iconPosition", "notEquals": "start" }` makes the property required while a sibling property (same table, not itself) has, or does not have, that value. The sibling's value is the node's value or its default; if the sibling or the property is a `<-` link the check is skipped. A missing value is `SUI-STATE-CONDITION`, naming both properties.
- **`runtime: true`.** Only controllers write the property (`error`, `touched`, `status`). It needs a `default`, cannot be `required` and cannot sit inside map items. A node that sets it, by value or by `<-` link, is `SUI-STATE-RUNTIME`. The flag is on `PropertyShape.runtime` for the catalog.
- **`reflect: true`.** `<sui-node>` writes the property as a host attribute. Not allowed on `node`, `array`, `object`, `map` or `any`, or inside map items. `reflectedProperties(shape)` returns the names in shape order; it is the only source of the `reflect(componentName)` list the application gives `<sui-node>`.
- **`icon` type.** The value is an icon name: lower-case letters, digits and `-` (the empty string means no icon). `validateNode(shape, node, statePath, { isIconName })` also asks the caller's function (the server reads `icons.json`) and reports a rejected name as `SUI-STATE-INVALID`; without it the core knows no icon list.
- **`row: true`.** Marks a `node` property, or a `node` field of a map item (table column `cell`, `descriptionList` item `node`), as a row template where `$row` links and `$row` `on` targets are legal. `validateNode` reports `$row` in a `<-` link or `on` entry of the node, or inside a slot value that is not a row property, as `SUI-LINK-ROW`. The tree walker calls `validateNode` on a template node itself with `{ insideRow: true }`, which turns the check off.
- **Names.** A `_` name must have kind `content` and the reverse (`SUI-BUILD-KIND`). Names starting with `<-`, `$` or `__`, names that are not letters and digits, and the keys `component`, `layout`, `placement`, `theme` and `on` are `SUI-BUILD-NAME`.
- **Validators** (a closed set, in `VALIDATORS`): `oneOf` (a list of values), `pattern` (a regular expression of at most `MAX_PATTERN_LENGTH` = 200 characters; strings over `MAX_PATTERN_INPUT` = 10000 characters fail it), `range` and `length` (`{ "min": n, "max": n }`, either bound optional; `length` takes non-negative integers). An unknown validator is `SUI-BUILD-VALIDATOR`; options that are malformed or do not apply to the type are `SUI-BUILD-SHAPE`.
- **URL rule.** A `url` property accepts only `data:` images (`png`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `svg+xml`), `#` targets and relative targets. Other schemes, `//host`, backslashes, spaces and control characters are refused.
- **`parseShape(json, file)`** takes the file text or a parsed value and returns `{ shape, errors }`. It reports every problem (unknown keys are `SUI-BUILD-KEY`, a missing or bad summary is `SUI-BUILD-SUMMARY`, a default that does not fit is `SUI-BUILD-DEFAULT`, a bad pattern is `SUI-BUILD-PATTERN`) with the file; `shape` is set only when there are none.
- **`buildDefaults(shape)`** returns a fresh default state: every property that has a `default`.
- **`validateNode(shape, node, statePath)`** returns `SUI-STATE-*` violations with the state path: `SUI-STATE-UNKNOWN` (unknown property, a link to one, or `layout` on a component without it), `SUI-STATE-REQUIRED`,  or `__` keys). The optional fourth argument is `{ isIconName?, insideRow? }`. `<-name` links count as providing `name` and their value is not checked. `component`, `children`, `placement`, `theme` and `on` belong to the tree and are not checked here.

## Convention scan

`scanLibrary(fileMap)` turns a component library folder into a typed list of components by file convention alone. The
file map is a record of relative path (forward slashes) to content; only the paths are read, so it needs no file system
and no DOM.

    <group>/<name>/<name>.<role>.<ext>

| Role | File |
| --- | --- |
| view | `<name>.view.html` |
| css | `<name>.view.css` |
| controller | `<name>.controller.ts` |
| state | `<name>.state.json` |
| composed | `<name>.composed.json` |
| locale | `<name>.locale.<code>.json` |

- The folder name is the component name, camel-cased for state (`text-field` gives `textField`); the tag is `ui-` plus
  the folder name. Folder names are lower-case kebab. Parent folders are grouping only and become `group`.
- A folder is root (`view.html` and `state.json`) or composed (`composed.json`), never both.
- Result: `{ components, errors }`. Each component is `{ name, tier, tag, group, files, locales }`, sorted by name. A
  component with any problem is left out and its errors are reported; the others are still returned.
- Errors: `SUI-BUILD-FILE` (a file outside a component folder), `SUI-BUILD-ROLE` (an unknown role or a file name
  different from its folder), `SUI-BUILD-NAME` (a folder name that is not lower-case kebab), `SUI-BUILD-DUPLICATE` (two
  components with the same name, including a root and a composed one; both files named), `SUI-BUILD-TIER` (root and
  composed files in one folder) and `SUI-BUILD-MISSING` (a root component without its view or state file).

## Resolving a node

`resolveNode(node, library, composed?, { path? })` turns a node into one merged, fully resolved tree. It is pure and
never throws; problems come back in `errors`.

- A root component's node is merged over the shape's defaults. A composed component's node is merged over its default
  tree; its values address nested nodes by path, such as `footer.children.confirm._title`.
- Every nested node (`children` and node-typed slots) is resolved the same way, so a composed component can contain
  another one.
- Merging is deep and sparse. Arrays are replaced whole; `children` and slot maps merge by key; `null` removes a default
  child or slot node. A node that names a different component replaces the node under it.
- A composed file's `exposes` key is metadata and never reaches a resolved node.
- The document's `composed` entries win over the library; a name that is also a library name is `SUI-DOC-COMPOSED`
  (`checkComposedNames`).
- A composed component that contains itself through default trees is `SUI-NODE-CYCLE`, with the chain in the message;
  an unknown component is `SUI-NODE-UNKNOWN`. Both carry the state path.
- `instances` maps each state path where a composed component was expanded to the composed names, outermost first.

```ts
const { node, errors, instances } = resolveNode({ component: 'confirmDialog' }, library, document.composed);
```

## Building a component library

`@punyts/stateui-app/build` turns a component folder into registered StateUI components. A developer adds a component by
adding files; there is no manifest and no registration code.

    npx stateui-app-build <sourceDir> <outDir>

```ts
import { buildLibrary } from '@punyts/stateui-app/build';

const result = await buildLibrary('components', 'dist/components', { cssTransforms: [], cssChecks: [] });
// result.errors: SUI-BUILD errors with file, line and column; result.built: the components that built
```

The build scans the folder, compiles each root component's template and stylesheet with StateUI, and writes to `outDir`:

| File | Content |
| --- | --- |
| `<name>.js` | `name`, `tag`, `defaultState` (the shape's defaults), `options` (the `defineComponent` options) and `register()` |
| `<name>.controller.js` | The compiled `controller.ts`, when the component has one |
| `<name>.d.ts` | Types for the module |
| `index.js` | `components` (every module in name order) and `registerAll()` |

Composed components have no module; the catalog describes them.

- **Controllers.** `<name>.controller.ts` must export one factory as its default export and nothing else. It is
  transpiled, never run, and must not import sibling files.
- **Errors.** `SUI-BUILD-TEMPLATE`, `SUI-BUILD-STYLE`, `SUI-BUILD-CONTROLLER` and `SUI-BUILD-IO`, plus the shape and scan
  codes. A component with an error gets no module and the others are still built, so one run reports every problem.
  The CLI prints `file:line:column severity CODE message` and exits 1 on any error.
- **Extension points.** `cssTransforms` (CSS text to CSS text, run in order before StateUI compiles the CSS) and
  `cssChecks` (return `SUI-BUILD` errors; they see the CSS as written, so their lines match the file). With none
  registered the output is the same as without the points.
- **Deterministic.** The same input gives the same bytes: no timestamps, sorted output, LF newlines. Files left in
  `outDir` by earlier builds are not removed.
- **Node only.** The template check needs a DOM, so the build installs a happy-dom window when none exists; `happy-dom`
  and `typescript` must be installed. `./build` is not re-exported from `.`, so browser bundles never pull them in.

Register the modules directly: `import { registerAll } from './dist/components/index.js'; registerAll();`

## Build and test
Build `@punyts/state`, `@punyts/expression` and `@punyts/stateui` first.

```
npm run build
npm test
npm run test:browser
```

## License
MIT
