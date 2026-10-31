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

- **Top-level keys.** `summary` (required; one line, at most `MAX_SUMMARY_LENGTH` = 120 characters; served by `ui_components_list`), `properties`, `events` and `commands` (lists of lower camel-case names), `layout` (true when the component lays out children, so a node may carry `layout`). Keys are rows in the `SHAPE_KEYS` table (and `PROPERTY_KEYS` for a property): name, JSON type and rule. A later story adds `shared`, `tokens`, `placement`, `reflect`, `runtime` or `map` by adding a row.
- **Property keys.** `type` (required: `string`, `number`, `integer`, `boolean`, `array`, `object`, `any`, `url`, `icon`, `node`), `default`, `required`, `kind` (`content` is the only extra kind), `values` (allowed values), `validators`. A `node` property is a slot and must hold an object with a `component` name.
- **Names.** A `_` name must have kind `content` and the reverse (`SUI-BUILD-KIND`). Names starting with `<-`, `$` or `__`, names that are not letters and digits, and the keys `component`, `layout`, `placement`, `theme` and `on` are `SUI-BUILD-NAME`.
- **Validators** (a closed set, in `VALIDATORS`): `oneOf` (a list of values), `pattern` (a regular expression of at most `MAX_PATTERN_LENGTH` = 200 characters; strings over `MAX_PATTERN_INPUT` = 10000 characters fail it), `range` and `length` (`{ "min": n, "max": n }`, either bound optional; `length` takes non-negative integers). An unknown validator is `SUI-BUILD-VALIDATOR`; options that are malformed or do not apply to the type are `SUI-BUILD-SHAPE`.
- **URL rule.** A `url` property accepts only `data:` images (`png`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `svg+xml`), `#` targets and relative targets. Other schemes, `//host`, backslashes, spaces and control characters are refused.
- **`parseShape(json, file)`** takes the file text or a parsed value and returns `{ shape, errors }`. It reports every problem (unknown keys are `SUI-BUILD-KEY`, a missing or bad summary is `SUI-BUILD-SUMMARY`, a default that does not fit is `SUI-BUILD-DEFAULT`, a bad pattern is `SUI-BUILD-PATTERN`) with the file; `shape` is set only when there are none.
- **`buildDefaults(shape)`** returns a fresh default state: every property that has a `default`.
- **`validateNode(shape, node, statePath)`** returns `SUI-STATE-*` violations with the state path: `SUI-STATE-UNKNOWN` (unknown property, a link to one, or `layout` on a component without it), `SUI-STATE-REQUIRED`, `SUI-STATE-INVALID` (type, allowed values, validators, URL rule, slot not a node) and `SUI-NODE-NAME` (`$` or `__` keys). `<-name` links count as providing `name` and their value is not checked. `component`, `children`, `placement`, `theme` and `on` belong to the tree and are not checked here.

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

## Build and test
Build `@punyts/state`, `@punyts/expression` and `@punyts/stateui` first.

```
npm run build
npm test
npm run test:browser
```

## License
MIT
