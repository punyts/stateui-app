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
    "shared": { "tone": { "default": "accent" }, "size": {} },
    "properties": {
        "_label": { "type": "string", "kind": "content", "default": "Label" },
        "width": { "type": "string", "values": ["narrow", "wide"], "default": "wide" },
        "value": { "type": "string", "required": true, "validators": { "length": { "max": 40 } } },
        "header": { "type": "node" },
        "src": { "type": "url" }
    }
}
```

- **Top-level keys.** `shared` (see below), `summary` (required; one line, at most `MAX_SUMMARY_LENGTH` = 120 characters; served by `ui_components_list`), `properties`, `events` and `commands` (lists of lower camel-case names), `layout` (true when the component lays out children, so a node may carry `layout`). Keys are rows in the `SHAPE_KEYS` table (and `PROPERTY_KEYS` for a property): name, JSON type and rule. `tokens` and `tokenGroup` are described under Component tokens. `placement` is described under Layouts and placement.
- **Property keys.** `type` (required: `string`, `number`, `integer`, `boolean`, `array`, `object`, `any`, `url`, `icon`, `node`, `map`, or a list of them when several are allowed, as in `["array", "map"]`), `default`, `required`, `kind` (`content` is the only extra kind), `values` (allowed values), `validators`, `items`, `requiredWhen`, `runtime`, `exposed`, `reflect`, `row`. A `node` property is a slot and must hold an object with a `component` name.
- **Maps (`type: "map"`, `items`).** `items` is `"string"` (every value is a string, e.g. a `_errors` content map) or a sub-shape: an object of properties each map value may hold (table `columns`, static `select` options). A map type needs `items` and no other type may have it. Nested `_` properties inside `items` must be kind `content` and every other nested property must not (`SUI-BUILD-KIND`). `validateNode` walks maps and reports each violation with the map key in the path, e.g. `$.app.children.t.columns.total._title`.
- **`requiredWhen`.** `{ "property": "decorative", "equals": false }` or `{ "property": "iconPosition", "notEquals": "start" }` makes the property required while a sibling property (same table, not itself) has, or does not have, that value. The sibling's value is the node's value or its default; if the sibling or the property is a `<-` link the check is skipped. A missing value is `SUI-STATE-CONDITION`, naming both properties.
- **`runtime: true`.** Only controllers write the property (`error`, `touched`, `status`). It needs a `default`, cannot be `required` and cannot sit inside map items. A node that sets it, by value or by `<-` link, is `SUI-STATE-RUNTIME`. The flag is on `PropertyShape.runtime` for the catalog.
- **`exposed: true`.** Valid only with `runtime: true` (otherwise `SUI-BUILD-SHAPE`). An exposed property lives at `runtimePath(nodePath).<name>` and other nodes may link to it by node reference (see Links). `PropertyShape.exposed` is in the `shape` of the catalog entry, so the minion sees which runtime properties it may link to.
- **`reflect: true`.** `<sui-node>` writes the property as a host attribute. Not allowed on `node`, `array`, `object`, `map` or `any`, or inside map items. `reflectedProperties(shape)` returns the names in shape order; it is the only source of the `reflect(componentName)` list the application gives `<sui-node>`.
- **`icon` type.** The value is an icon name: lower-case letters, digits and `-` (the empty string means no icon). `validateNode(shape, node, statePath, { isIconName })` also asks the caller's function (the server reads `icons.json`) and reports a rejected name as `SUI-STATE-INVALID`; without it the core knows no icon list.
- **`row: true`.** Marks a `node` property, or a `node` field of a map item (table column `cell`, `descriptionList` item `node`), as a row template where `$row` links and `$row` `on` targets are legal. `validateNode` reports `$row` in a `<-` link or `on` entry of the node, or inside a slot value that is not a row property, as `SUI-LINK-ROW`. The tree walker calls `validateNode` on a template node itself with `{ insideRow: true }`, which turns the check off.
- **Shared articulation (`shared`).** One vocabulary for all components, in `src/core/articulation/`: `tone` (neutral, accent, danger, warning, success, info), `variant` (solid, soft, outline, ghost, link), `size` (sm, md, lg), `density` (compact, comfortable, spacious), `elevation` (flat, raised, overlay), `textRole` (display, title, heading, body, label, caption, code). A shape lists the ones it supports in `shared`, each with an optional `default` from the list; `parseShape` expands each into a reflected string property with the list as its `values`. `hidden` (boolean, reflected) is added to every shape and is never declared. An unknown shared name or a `hidden` entry is `SUI-BUILD-SHAPE`, a default outside the list `SUI-BUILD-DEFAULT`. An own property may not use a shared name (a modal's width choice is `width`, a tab strip's look is `appearance`): `SUI-BUILD-SHAPE`. A node that sets a shared property the component does not support is `SUI-STATE-SHARED`, naming the supported ones; a value outside the list is `SUI-STATE-INVALID`. `attributeName(name)` gives the host attribute (`textRole` is `text-role`). `Shape.shared` lists the declared names; the catalog entry lists `shared` (with `hidden`) and `own` properties separately.
- **Names.** A `_` name must have kind `content` and the reverse (`SUI-BUILD-KIND`). Names starting with `<-`, `$` or `__`, names that are not letters and digits, and the keys `component`, `layout`, `placement`, `theme` and `on` are `SUI-BUILD-NAME`.
- **Validators** (a closed set, in `VALIDATORS`): `oneOf` (a list of values), `pattern` (a regular expression of at most `MAX_PATTERN_LENGTH` = 200 characters; strings over `MAX_PATTERN_INPUT` = 10000 characters fail it), `range` and `length` (`{ "min": n, "max": n }`, either bound optional; `length` takes non-negative integers). An unknown validator is `SUI-BUILD-VALIDATOR`; options that are malformed or do not apply to the type are `SUI-BUILD-SHAPE`.
- **URL rule.** A `url` property accepts only `data:` images (`png`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `svg+xml`), `#` targets and relative targets. Other schemes, `//host`, backslashes, spaces and control characters are refused. A `pattern` validator also applies to a `url` and narrows it further (`"^data:"` for images only, `"^(?!data:)"` for links).
- **`parseShape(json, file)`** takes the file text or a parsed value and returns `{ shape, errors }`. It reports every problem (unknown keys are `SUI-BUILD-KEY`, a missing or bad summary is `SUI-BUILD-SUMMARY`, a default that does not fit is `SUI-BUILD-DEFAULT`, a bad pattern is `SUI-BUILD-PATTERN`) with the file; `shape` is set only when there are none.
- **`buildDefaults(shape)`** returns a fresh default state: every property that has a `default`.
- **`validateNode(shape, node, statePath)`** returns `SUI-STATE-*` violations with the state path: `SUI-STATE-UNKNOWN` (unknown property or a link to one), `SUI-STATE-SHARED` (an unsupported shared property), `SUI-STATE-REQUIRED`, `SUI-STATE-INVALID` (type, allowed values, validators, URL rule, icon name, slot not a node, map contents), `SUI-STATE-CONDITION`, `SUI-STATE-RUNTIME`, `SUI-LINK-ROW` and `SUI-NODE-NAME` (`$` or `__` keys). The optional fourth argument is `{ isIconName?, insideRow? }`. `<-name` links count as providing `name` and their value is not checked. `component`, `children`, `placement`, `theme` and `on` belong to the tree and are not checked here.

### Component tokens

A shape declares the knobs a minion may change as `tokens`: nested objects whose leaves are references to semantic tokens.

```json
{
    "summary": "A button",
    "tokens": {
        "radius": "{radius.md}",
        "padding": { "inline": "{space.inset.md}", "block": "{space.inset.sm}" },
        "row": "calc({size.control.md} * {density.factor})"
    }
}
```

- **Group.** The tokens live under `tokenGroup`, a lower-case word (`^[a-z][a-z0-9]*$`, not a default group such as `color`). It defaults to the component name, taken from the shape file name (`button.state.json` gives `button`). A camelCase name (`record-list.state.json` is `recordList`) without `tokenGroup` is `SUI-BUILD-TOKENGROUP` naming the file, as is an unusable `tokenGroup`. Shapes of one family share a group (`field`, `control`).
- **Defaults.** `inferComponentDefault(value)` checks each default with the value rules of Theme tokens: it must reference at least one semantic token (a literal, a primitive, a component token or an unknown path is `SUI-BUILD-TOKENDEF`), and the type is inferred from the referenced token (a `calc()` of dimensions and numbers with at least one dimension is a `dimension`). A token key that is not lower-case letters and digits is `SUI-BUILD-NAME`.
- **`Shape.tokens`** lists `{ path, group, type, default }` per leaf, the path starting with the group (`button.padding.inline`); absent when the shape declares none.
- **`collectComponentTokens(sources)`** takes `{ file, shape }` entries and returns `{ tokens, errors }`: the token set of the library sorted by path. Shapes that share a group must declare identical entries; otherwise each of them gets a `SUI-BUILD-TOKENCONFLICT` naming its file and the first file of the group, and its entries are left out.
- **Lookup.** The paths and types join `validateTokens` (`componentTokens` option); the `theme` document validator reads them from the library's shapes, so a document or overlay may set `button.radius` only when a shape declares it. The catalog entry carries `tokens` (and `shape.tokens`).

### Shared articulation stylesheet

`generateSharedSheet()` (`src/dom/articulation/`) returns the CSS that turns the reflected attributes into local custom properties: `tone` gives `--tone`, `--tone-soft` and `--tone-on`; `size` gives `--control-height` and `--icon-size`; `elevation` gives `--surface` and `--shadow`; `textRole` (attribute `text-role`) gives `--text-family`, `--text-size`, `--text-weight` and `--text-leading`; `hidden` removes the host from layout. The build prepends it to every root component's CSS (a component with no `view.css` gets it alone; style error lines still match the component's file), so component CSS says `background: var(--tone)` and never repeats the tone table. `variant` has no rule here: the component's CSS decides how each variant paints the tone properties. `mountApp` reflects the shared names and `hidden` onto each node's element through `<sui-node>`, so no component code is involved.

`density` on a container sets `--ui-density-factor` to the chosen multiplier (`density.compact`, `comfortable` or `spacious`) on that host and re-declares every semantic token whose default value uses `{density.factor}` (`space.inset`, `gap` and `stack`) from its default expression. A `var()` is resolved where the property is declared, so the re-declaration is what makes the `calc()` use the host's factor; everything below the container follows, so one `density` on a form changes every field. Limit: a node `theme` override of a `space` token is not carried into a nested density host, which re-declares `space.*` from the default expression.

The sheet also draws focus: `:host(:focus-visible)` and `:focus-visible` inside every shadow root get `outline: var(--ui-focus-width) solid var(--ui-color-focus)` and `outline-offset: var(--ui-focus-offset)`, so components do not style focus themselves. Under `@media (forced-colors: active)` the local colours map to system colours (`--tone: ButtonText`, `--tone-soft: Canvas`, `--tone-on: CanvasText`, `--surface: Canvas`), shadows are removed (`--shadow: none`) and the focus outline is `Highlight`; the block comes after the tone and elevation rules and repeats their attribute selectors so it wins.

### Layouts and placement

`src/core/layout/` holds the closed list of layout types: `column`, `row`, `grid`, `region` and `adhoc`. A node sets `layout: { "type": "grid", "cols": 3 }`, and each child sets `placement`. Each type has its own settings and placement fields:

| Type | Container settings | Child placement |
|------|--------------------|-----------------|
| `column` | `gap`, `align` | `grow` |
| `row` | `gap`, `align`, `wrap`, `collapseBelow` | `grow` |
| `grid` | `cols`, `rows`, `gap`, `collapseBelow` | `col`, `row`, `span`, `rowSpan` |
| `region` | `gap`, `collapseBelow` | `region` (`n`, `ne`, `e`, `se`, `s`, `sw`, `w`, `nw`, `center`) |
| `adhoc` | none | `x`, `y`, `width`, `height` |

Allowed values: `gap` is `none`, `sm`, `md` or `lg`; `align` is `start`, `center`, `end` or `stretch`; `wrap` is boolean; `cols`, `rows`, `col`, `row`, `span` and `rowSpan` are integers 1 to 12; `grow` is a number 0 to 12; `collapseBelow` is `sm`, `md`, `lg` or `xl`; `x`, `y`, `width` and `height` are literal dimensions (`4px`, `1.5rem`, `50%`, `0`), never `calc()` or a token reference.

A component that has no `layout` can declare the placement its children carry with a `placement` key in its `*.state.json`: a table of properties like `properties`, where `_` properties are content (tabs: `_tab`, `icon`, `badge`). A shape cannot have both `"layout": true` and `placement`.

`validateDocument` runs the `layout` and `placement` validators, which report `SUI-LAYOUT-TYPE`, `-SETTING`, `-VALUE`, `-FIELD`, `-PLACEMENT` and `-REQUIRED` for unknown or disallowed types, settings and fields, `SUI-LAYOUT-UNSUPPORTED` for a `layout` on a component whose shape does not support it, `SUI-LAYOUT-PARENT` for a `placement` under a parent that has neither a layout nor a placement shape (naming the parent), and `SUI-LAYOUT-ROOT` for a `placement` on the app root. Composed components are checked under `$.composed.<name>`. `validateNode` ignores `layout`; the layout validator reports it.

A component whose shape sets `"layout": true` marks the element that holds its children with `<div layout-host="" />` in its view; the build rejects a layout-capable component without a `layout-host`, and a `layout-host` in a component that does not support `layout`, as `SUI-BUILD-TEMPLATE` naming the view file. `<sui-node>` writes `layout`, `layout-<setting>` attributes and `--layout-<setting>` custom properties on the `layout-host`, and `placement` as attributes (`region="nw"`, `col="2"`, `row-span="2"`) on each child. The build prepends one stylesheet per layout type (`generateLayoutSheets`, `src/dom/layout/`), generated from the closed lists, to every layout-capable component, so changing `layout` or `placement` in state rearranges the children with no component code. The `layout-host` sets `container-type: inline-size`, so keep it a block-level box: a host that sizes to its content collapses to zero width.

**Breakpoints.** `BREAKPOINTS` is `sm` 480, `md` 768, `lg` 1024 and `xl` 1280 px of container width. A `grid`, `row` or `region` with `collapseBelow` stacks its children as one column in key order when its container is narrower than that width; without `collapseBelow` it never collapses. A container query cannot restyle its own container, so the sheet makes the component host `display: block; container-type: inline-size` and the queries restyle the `layout-host` inside it. The width compared is the host's content box, so the host's own padding is not counted. A nested layout host responds to its own component host's width.

Limits: `grow` has rules for whole numbers 0 to 12 only; `adhoc` placement (`x`, `y`, `width`, `height`) uses typed `attr()`, so it needs a browser that supports it (Chromium 133 and later), and the `adhoc` container needs its own height because its children are absolutely positioned; empty tracks of a `region` layout still take the gap.

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

## Links

Code is in `src/core/links/`, exported from `@punyts/stateui-app/core`. A `<-key` property makes the node's `key` a
store alias (`store.link`) of its target, so reads, writes and change events follow the data.

- **`extractLinks(resolvedTree, { path? })`** returns `{ tree, links, linkedPaths, errors }`. `links` holds
  `{ statePath, key, target }` for every `<-key` (in nodes and in nested objects such as map items; `on` entries are
  skipped), `tree` is a copy without them. A target must start with `$.data` or `$row`, or be a node reference
  (`^name.path`, `.path`) to an exposed runtime property; anything else is `SUI-LINK-TARGET`, an empty key is
  `SUI-NODE-NAME`. `linkedPaths` lists every linked property path (`statePath.key`); locale overlays and the live-state
  snapshot exclude them.
- **Node references.** `^name.path` (nearest ancestor, the node itself included, named `name` or an instance of composed
  component `name`) and `.path` (own subtree) may be a link target when the property they reach is `exposed` in that
  node's shape: `"<-value": "^orders.current.customer"`. With `options.library` (and `instances`, the `resolveNode`
  result) `extractLinks` resolves the reference to the runtime path, `^orders.current` giving
  `$.runtime.nodes.app.…orders.current`. A node that does not exist, or whose shape has no such exposed property (not
  exposed, or not there at all), is `SUI-LINK-MISSING` with the state path of the link. `..x`, absolute `$.app` targets
  and any other form are `SUI-LINK-TARGET`. Without a library references are returned as written. Inside a row
  template (a `row: true` slot or map-item field) relative references resolve against the node that owns the
  template; `resolveRowLinks` takes `owner` (the owner's chain) for the same rule, and `library`.
- **`applyLinks(store, links)`** calls `store.link(statePath.key, target)` and returns errors: `SUI-LINK-CYCLE` when the
  target is the property, inside it, above it or loops through other links, `SUI-LINK-MISSING` otherwise, each with the
  node path. It is idempotent per store (the same link twice does nothing; a new target re-points) and tries every link.
  `disposeLinks(store, links)` unlinks what `applyLinks` created; listeners stay registered.
- **`runtimePath(appPath)`** is the only place that builds a node's runtime path: `$.app.a.b` gives
  `$.runtime.nodes.app.a.b`. `RUNTIME_PATHS` names `nodes`, `icons` and `empty`, which are separate keys.
- **`resolveRowLinks(rowNode, rowPath, { path? })`** is `extractLinks` for one record-view slot: `$row.x` becomes
  `<rowPath>.x` (for example `$.runtime.nodes.app.orders.slots.3.row.customer`) with `allowMissing: true`, so a missing
  field reads as `undefined` and updates when it appears. Only `row` is re-pointed. `path` is the row node's state path
  and defaults to the parent of `rowPath`.

## `on` entries and targets

A node's `on` maps an event its component declares to one command object or an ordered list of them.

```json
"on": { "press": [ { "command": "set", "target": "$.data.name", "value": "x" }, { "command": "close", "target": "$parent" } ] }
```

A command object is `{ command, target?, value? }`. `value` is the command's argument: what `set` writes, the key
`select` takes, the payload `emit` sends. When `value` is absent, `emit` sends the event's payload.

| Command | `target` | `value` |
| --- | --- | --- |
| `set` | a property to write (`$.data.name`, `.pressed`) | required |
| `toggle` | a boolean property | none |
| `emit` | the event name, such as `chat.send` (not resolved) | the payload |
| a component command | a node; absent means the node itself | the argument |

Targets: `^name.path` (nearest node, starting with the node itself, whose key is `name` or that is an instance of
composed component `name`, then the path below it), `.path` (own subtree), `$parent` (nearest ancestor whose component
declares the command), `$row` / `$row.path` (the record a row template's slot shows) and `$.app…` (absolute). Dot
climbing (`..x`) is rejected.

**`$row`.** Legal as a `target` and as a `value` (`"value": "$row.id"`) only inside a row template (the value of a
`row: true` property or map-item field). It resolves through the slot's `row` alias, so `{ "command": "set", "target":
"$.data.selected", "value": "$row.id" }` writes the id of the record the slot shows and `{ "command": "delete", "target":
"$row" }` is a component command handled by the node that owns the template (the nearest node of its chain whose shape
declares the command). Outside a row template `$row` is `SUI-ON-TARGET` (and `SUI-LINK-ROW` from `validateNode`). Other
relative targets (`^name.path`, `.path`) inside a row template resolve against the owning node's `$.app` path, never
against the slot's runtime path. `resolveTarget(target, chain, rootPath, rowPath?)` takes the row alias path (any marker
when validating) and `findRowProvider` picks the owner for a command aimed at `$row`.

`validateOn(resolveResult, library)` returns `SUI-ON-SHAPE` (an entry that is not a command object or a list of them),
`SUI-ON-EVENT`, `SUI-ON-COMMAND` and `SUI-ON-TARGET` errors with the state path. `parseTarget` and `resolveTarget` are
exported so the runtime dispatcher uses the same rules.

## Document validation

`validateDocument(document, catalog, options?)` runs every structural check without a DOM and returns
`{ valid, errors }`. `catalog` is a `ComponentLibrary` or the content of `catalog.json` (`libraryFromCatalog` converts
it). `valid` ignores warnings. The function never throws; every error carries a state path (`$` when it concerns the
whole document). `options.isIconName` checks icon names against the server's `icons.json`.

Order of checks:

1. A value that is not an object, or cannot be serialised, is `SUI-DOC-SHAPE`.
2. The closed limits (nodes, depth, bytes, data). A breach returns only the limit errors and nothing else runs, so an
   oversized document is never resolved.
3. Root keys and their types (`SUI-DOC-TYPE`; `runtime` and unknown keys are `SUI-DOC-KEY`), and a missing `app`
   (`SUI-NODE-MISSING`).
4. Integer-like keys in `children`, `options`, `columns`, `items`, `steps`, `messages` and every object under `data`
   (`SUI-DOC-ORDER`).
5. The `app` tree and each document `composed` tree: every component resolves, composed cycles, reserved names, each
   merged node against its shape (`validateNode`), and `<-` links. A `$.data` target must exist, a node reference must
   reach a property its component declares, and a node reference must reach an exposed runtime property (`SUI-LINK-MISSING`). Exposed properties are runtime
   branches no link can have as its own key, so links cannot loop through node references.
6. The registered plug-in validators, whose errors are merged.

`registerDocumentValidator(name, (context) => BuildError[])` returns a function that removes it. `context` holds the
`document`, the `library` and the resolved `tree` (`node`, `instances`). Validators run in registration order; the `on`
validator (`validateOn`) is registered by default, and the layout, placement, theme and locale validators of epic 3
register the same way. A validator that throws is reported as `SUI-DOC-VALIDATOR`.

Node fields inside map items (a table column's `cell`, a `descriptionList` item `node`) are resolved, validated against
their component's shape and checked for `on` and links like any other node; those of a `row: true` field are row
templates. `nodeChildren(node, path, shape)` (from `@punyts/stateui-app/core`) lists the nodes below a node this way.

A runtime property that still has its default in a resolved node counts as not set; only a node that gives it another
value is `SUI-STATE-RUNTIME`.

## Dispatching `on` in the browser

`createDispatcher({ host, store, library, instances?, rootPath?, hooks? })` listens on `host` (the element the store is
mounted on) and runs the `on` entry of the node that raised an event. It returns `{ dispose() }`.

**Events.** A root component raises an event on its own element, with `bubbles` and `composed` set; `detail` is the
payload:

    element.dispatchEvent(new CustomEvent('press', { detail, bubbles: true, composed: true }));

The node is the one at the element's state path. An event the node's `on` does not mention does nothing.

**Slots in the runtime branch.** An event raised by a node under `$.runtime.nodes` (a record-view slot, a table cell) runs
the `on` entry of that runtime node. Its owner is the longest prefix of its app path that is a node of `$.app`; relative
targets resolve against the owner's chain, and `$row` against the `row` alias of the nearest slot at or above the node
(`<slot>.row`).

**Commands.** An entry is one command or an ordered list. A failing command stops the list and reports, through
`@punyts/core` and `hooks.onError`, with the node's state path: `SUI-RUN-ON-TARGET` (a target that does not resolve),
`SUI-RUN-ON-COMMAND` (the store refuses a write, `toggle` meets a value that is not a boolean, a component command is not
declared or not handled, a handler or `onEmit` throws) or `SUI-RUN-ON-SHAPE` (a malformed entry).

- `set`: writes `value` to the target property or path.
- `toggle`: negates the boolean at the target.
- `emit`: calls `hooks.onEmit(target, payload)`. `target` is the event name; the payload is `value`, or the event's
  `detail` when `value` is absent.
- Any other command is a component command. The target defaults to the node itself; `$parent` is the nearest ancestor
  whose shape declares the command.

**Component command interface.** A root component lists its commands in the shape's `commands`. At run time its element
carries a `commands` object with one synchronous function per listed command:

```ts
controller: ({ element }) => {
    (element as CommandElement).commands = {
        close: (value, payload) => { /* value: the command's value; payload: the event's detail */ }
    };
    return { dispose: () => { delete (element as CommandElement).commands; } };
}
```

A command aimed at `$row` from a row template is also given the store path of the record as a third argument. The function
throws to fail. The dispatcher does not search closed shadow roots.

## Starting an application: `mountApp`

`mountApp(host, document, library, hooks?)` is the single entry point (`src/dom/mount/`, exported from
`@punyts/stateui-app`, not from `./core`). `library` is a `ComponentLibrary` (`libraryFromCatalog(catalog)` builds one) and
its component modules must be registered already, for example with the build's `registerAll()`. `hooks` is the
dispatcher's `{ onEmit?, onError? }`.

```ts
const { store, errors, dispose } = mountApp(host, document, library, { onEmit });
```

1. `validateDocument` runs first. Any error (a warning does not count) stops the run: `store` is `undefined`, `errors`
   holds everything found with state paths, and nothing is added to `host`.
2. `composed` is resolved against the library and `app` is resolved node by node. `<-` properties are removed from the
   tree, node references are resolved to the exposed runtime properties they reach, and the links become store aliases
   (`applyLinks`) once the store exists. A link that cannot be resolved or applied stops the run.
3. The store holds `{ theme, data, locale, app, runtime }`:
   - `theme` is `{ tokens, active }`: the document's `theme.tokens` over the default tree (every token, so a write patches one custom property) and `active` as `{ mode: "light", brand: "default", motion: "full" }` unless the document gives other names. See Token emission below.
   - `data` is a copy of the document's `data`; the document itself is never changed.
   - `locale` is the document's, `"en"` by default.
   - `runtime` is never read from the document: `nodes` (`{}`), `icons` (`{}`, written by the host's `load` message) and
     `empty` (`{}`, the shared empty record). `$.runtime.empty` is protected, so nothing can write into it.
4. `<sui-node>` gets a resolver (component name to the root component's tag) and options (`reflect(name)` from the shapes'
   `reflect: true` properties). The store is mounted on `host`, the `on` dispatcher is attached and `<ui-app-root>`
   is appended; it holds `<sui-node state="$.app">`. If the library registers its own `ui-app-root` first, that one is used (it then carries no token properties).
5. `dispose()` removes the root element, unmounts, unlinks, removes the dispatcher's listeners and clears the resolver and
   options (only if no later `mountApp` replaced them). It is safe to call twice. The resolver and options are global to
   StateUI, so run one app per page at a time.

**Steps.** `registerMountStep(name, { prepare?, start? })` adds a step; it returns a function that removes it. `prepare`
runs before the store exists and may replace `context.state.theme` and `context.state.locale` or change
`context.options` (the `<sui-node>` options). `start` runs after links are applied and before the first render, gets
`context.store`, and may return a function that `dispose` calls. A step that throws stops the run with `SUI-RUN-BINDING`.
Registering a name again replaces the step and keeps its place; `mountSteps()` lists them in order.

### Locale overlays

Code is in `src/core/locale/` (exported from `./core`) and `src/dom/locale/`. `mountApp` keeps the content of the application as it was mounted: `app.baseOverlay` (every `_` property that is not linked, including keyed-map entries such as `columns.<key>._title`, `placement._tab` and content maps such as `_errors`) and `app.baseLocale`. `switchLocale(store, 'de', { [app.baseLocale]: app.baseOverlay, de: germanOverlay })` applies a copy of the overlay to `$.app` and sets `$.locale`; applying the base overlay switches back. A language without an overlay returns `SUI-LOCALE-UNKNOWN` and changes nothing. `$.data` and `$.theme` are never touched.

`extractBaseOverlay(tree, linkedPaths)` builds that overlay from a resolved tree (arrays are not searched; an overlay cannot address an array item). `validateLocaleOverlay(code, overlay, app, { linkedPaths, library })` rejects a leaf that is not a `_` text property or inside a `_` content map (`SUI-LOCALE-CONTENT`), a linked property (`SUI-LOCALE-LINKED`) and a path the application does not have (`SUI-LOCALE-PATH`); with `library`, each `_` leaf must be a `kind: content` property of its component.

**Component overlays and the application overlay.** A component ships one overlay per language as `<name>.locale.<code>.json`, next to its other files. A root component's overlay holds `_` content properties of its shape, including map items (`options.<key>._label`, `columns.<key>._title`). A composed component's overlay is relative to its default tree and may reach any content path in it (`children.status.options.open._label`, `children.tabs.children.one.placement._tab`). `buildAppOverlay(code, resolvedApp, componentOverlays, appOverrides, { library, composed, instances, linkedPaths })` assembles the overlay for the whole application: each node gets its root component's overlay and the overlay of every composed component it was expanded from, so a composed component used three times is translated once. The document's `locales[code]` wins. With `library`, a component overlay replaces only content that still holds the component's default, so text the author wrote is never overwritten. Without `instances`, composed overlays are not applied.

`validateAppLocale(code, resolvedApp, componentOverlays, appOverrides, options)` returns the errors of the document's own overrides and a `SUI-LOCALE-MISSING` warning for each content path the language does not translate, in tree order, naming the language and state path. It lists at most `MAX_MISSING_PER_LANGUAGE` (50) and adds one `SUI-LOCALE-MORE` warning that counts the rest. Empty text is not counted, and a language with overlays for only some components is allowed. `validateDocument` runs the registered `locale` validator, which checks `document.locales` for `SUI-LOCALE-CONTENT`, `SUI-LOCALE-PATH` and `SUI-LOCALE-LINKED`; it cannot report missing content, because a document does not carry component overlays, so the server calls `validateAppLocale` for that.

**Nodes created later.** `registerLocaleStep(componentOverlays)` registers a mount step. After `mountApp` it builds the overlay of each language (the base overlay for the mounted content, `buildAppOverlay` for the rest) and watches `$.app`. A node written later (a keyed entry added to `children`, a `children` map added to a node, a composed node, a keyed entry such as a static select option) gets its component's overlay for the current `$.locale` in the same write, before it renders. Each language's overlay learns the new content, so `handle.switchTo(code)` keeps it translated and switching back restores the original text; a delete removes the node from the overlays. Text the author wrote that differs from the component default is kept, and the document's `locales` overrides for the path apply. Code that creates nodes itself (list and table rows, modals) calls `handle.nodes.prepare(path, node, instances?)` immediately before writing and writes what it returns; a composed node needs its `ResolveResult.instances`. Writing over an existing node is an update, not a creation, so add nodes under new keys.

## State snapshot

Code is in `src/core/snapshot/`, exported from `@punyts/stateui-app/core`. The preview host calls it for the `snapshot`
message (E7.1).

- **`snapshotState(store, { exclude? })`** returns `{ data, app }`. `data` is a copy of `$.data`. `app` is a copy of
  `$.app` reduced to its articulation values (an open modal, a typed field value) in the same `children` structure;
  `component`, `on`, `layout`, `placement`, `theme` and content (`_` keys) stay in the document, and nodes left with
  nothing are absent. It reads only `$.data` and `$.app`, so `$.runtime` (slots, `current`, icons) never appears.
  Linked properties and content are store aliases and computed values are not state, so `store.get` never returns them
  and they are not in the result. The `$.runtime` rule lives here; `@punyts/state` does not know the branch.
- **`exclude(path)`** is called with the state path of every value before it is copied (`$.data.user.password`,
  `$.app.children.name.value`); `true` leaves out that value and everything below it, and an excluded array item is
  removed. Password-type fields are the caller's to name (E7.1).
- The function returns what the store holds now; it does not know which values the user changed. The host loads the
  result over the document, so values equal to the document's are harmless.

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
| `catalog.json` | Every component that built, root and composed, sorted by name: `name`, `tier`, `tag`, `size`, `summary`, `shape`, `content`, `slots`, `events`, `commands`, `layout`, `locales`, `example` (composed entries have `tree` instead of the shape fields) |
| `<name>.locale.<code>.json` | The validated overlay of a root or composed component, one file per language |
| `index.js` | `components` (every module in name order), `componentTokens` (the library's component tokens: `path`, `group`, `type`, `default`) and `registerAll()` |

Composed components have no module; `catalog.json` describes them with their default tree.

- **Controllers.** `<name>.controller.ts` must export one factory as its default export and nothing else. It is
  transpiled, never run, and must not import sibling files.
- **Errors.** `SUI-BUILD-TEMPLATE`, `SUI-BUILD-STYLE`, `SUI-BUILD-CONTROLLER` and `SUI-BUILD-IO`, plus the shape and scan
  codes. A component with an error gets no module and no catalog entry, and the others are still built, so one run reports every problem.
  The CLI prints `file:line:column severity CODE message` and exits 1 on any error.
- **Catalog.** `catalog.json` is the file the minion and the server read; it needs no DOM. `size` comes from the nearest
  `atoms`, `molecules`, `composites` or `composed` parent folder (a component elsewhere is `SUI-BUILD-GROUP`).
  `summary` is the shape's required `summary`. `shape` is what `validateNode` takes, `content` and `slots` list the `_`
  and `node` properties (`map.field` inside map items), and `example` is the component with its required properties.
  An entry also carries `shared`, `tokens`, `placement` and `exposes` when the shape declares them. `catalog.json` also
  has a top-level `locales`: every language a built component has an overlay for, sorted. The same result is
  `BuildResult.catalog`.
- **Locale overlays.** Each `<name>.locale.<code>.json` is checked while building. A root overlay may name only `_`
  content properties of its shape (and `_` properties inside map items); anything else is `SUI-LOCALE-CONTENT` or
  `SUI-LOCALE-PATH`. A composed overlay is checked against its resolved default tree. An error names the file; the
  component with the error gets no module or catalog entry, and a file that is not valid JSON or not an object is
  `SUI-BUILD-SHAPE`.
- **Extension points.** `cssTransforms` (CSS text to CSS text, run in order before StateUI compiles the CSS) and
  `cssChecks` (return `SUI-BUILD` errors; they see the CSS as written, so their lines match the file). With none
  registered the output is the same as without the points.
- **Shared stylesheets (`sharedCssDir`).** With `buildLibrary(src, out, { sharedCssDir: 'src/shared/css' })`, a line that holds only `@include "<name>.css";` in a component's `view.css` is replaced with the text of `<name>.css` from that folder, before the `cssChecks`, the built-in checks and the transforms run. The token lint therefore checks the partial as part of every component that includes it, and the token fallbacks apply to it. The name must be a plain file name (`^[a-z0-9][a-z0-9-]*\.css$`); an unknown file, a name with a path, and an `@include` inside a partial are `SUI-BUILD-IO` errors at the include line and column, and the component gets no module. Lines reported after an include count the inlined text. Without the option no line is touched.
- **Component token fallbacks.** The build reads every root shape first, so a component's CSS is handled against the tokens of the whole library. The `applyTokenFallbacks` transform (always run, after the shared sheets) rewrites each bare `var(--ui-<group>-<token>)` of a declared component token to `var(--ui-<group>-<token>, <default as var() references>)`; comments and strings are left alone. The default is only a CSS fallback: nothing is written on `<ui-app-root>`, so a node `theme` override of the semantic token still reaches the component. `CssContext` has `tokens`, the library's component tokens.
- **Token lint (`SUI-BUILD-TOKEN`).** The `checkTokens` check always runs on every `view.css` as written, and the build runs `lintCss` on the generated shared sheet. Each error has the file and the 1-based line and column of the name or colour: `var(--ui-palette-*)`, `var(--ui-scale-*)` and any `var(--ui-font-*)` (primitives); a `var(--ui-*)` that is neither a default token nor a declared component token (a token of another group is fine); a literal colour (`#hex`, `rgb(`, `rgba(`, `hsl(`, `hsla(`) in a declaration value; and a hand-written fallback on a declared component token that differs from the shape default (whitespace ignored). Comments, strings, `url()` contents and id selectors are not checked. One declaration is exempt: a custom property that is a default semantic token written with that token's own default expression, which is how the shared sheet re-declares the density-dependent space tokens on a density host. A component with a violation gets no module and the others still build. `lintCss(css, { file, tokens })` is exported from `./build` for CSS the build does not own, such as a shared partial a later step inlines. The lint also rejects removing an outline (`outline: none`, `outline: 0`, `outline-width: 0`) and a literal `ms` or `s` duration in `transition` and `animation` declarations and their `-duration` and `-delay` properties: use the `--ui-motion-duration-*` tokens, which the `motion: "reduced"` overlay sets to `0ms`.
- **Deterministic.** The same input gives the same bytes: no timestamps, sorted output, LF newlines. Files left in
  `outDir` by earlier builds are not removed.
- **Node only.** The template check needs a DOM, so the build installs a happy-dom window when none exists; `happy-dom`
  and `typescript` must be installed. `./build` is not re-exported from `.`, so browser bundles never pull them in.

Register the modules directly: `import { registerAll } from './dist/components/index.js'; registerAll();`

## Theme tokens
The token tree, its types, references and value checks. Code is in `src/core/theme/`, exported from `@punyts/stateui-app/core`. The design is `knowledge-base/design/stateui-ui-builder-styles.md` in the ai-minion repo.

- **Default tree.** `src/core/theme/tokens.default.json` is the tree for the `light` mode and `default` brand: the primitive groups `palette`, `scale` and `font`, and the semantic groups `color`, `space`, `size`, `icon`, `radius`, `border`, `elevation`, `text`, `motion`, `density` and `focus`. It has no component group; component tokens come from shapes. `DEFAULT_TOKENS` is the parsed tree and the JSON is the `@punyts/stateui-app/tokens.json` export. The library chose the `scale.size` steps (`1` to `8`: 16, 20, 24, 28, 32, 36, 44, 56 px), the `size.control` and `size.icon` references and the `light` colours. The semantic `space` tokens are `calc(<scale.space step> * <density.factor>)`. Leaves are strings and keys are lower-case letters and digits, never dotted.
- **`flattenTokens(tree, componentTypes?)`** returns every leaf as `{ path, cssName, layer, type, value }`. The layer comes from the first path segment (`palette`, `scale`, `font`: primitive; the other default groups: semantic; anything else: component). The type comes from the path (`tokenTypeOf`), or from the optional `componentTypes` map for component leaves; a leaf with neither has no `type`. `TokenType` is `color`, `dimension`, `number`, `duration`, `easing`, `shadow`, `fontFamily` or `fontWeight`.
- **`cssName(path)`** joins the path with `-` and prefixes `--ui-` (`color.text.muted` gives `--ui-color-text-muted`). A segment that is not lower-case letters and digits throws a `TokenNameError` whose `error` is the `SUI-THEME-NAME` with the state path; `validateTokenNames(tree)` returns the same errors for a whole tree, a dotted key included.
- **References.** `parseValue(text)` splits a value into text and `{path}` parts; `toCssValue(text)` turns each reference into a live `var(--ui-<path joined by ->)` (`calc({scale.space.3} * {density.factor})` gives `calc(var(--ui-scale-space-3) * var(--ui-density-factor))`). Nothing is resolved in JavaScript at runtime. `validateReferences(leaves)` returns `SUI-THEME-REF` with the state path for an unknown reference (a group is not a token), a reference against the layer direction (a primitive that references anything; a semantic token that references a component token; a component token that references a primitive or another component token) and a cycle among semantic tokens, with the chain in the message.
- **Values.** `validateTokenValue(type, text, typeOf?)` returns true when the value fits the type: `color` (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `transparent`), `dimension` (`0`, a number with `px`, `rem` or `%`, or a `calc()` of those and references), `number`, `duration` (`ms` or `s`, the unit is required), `easing` (keywords and `cubic-bezier()` with x values from 0 to 1), `shadow` (`none` or comma-separated `x y blur spread color` groups), `fontFamily`, `fontWeight` (100 to 900, `normal`, `bold`). A value that is one reference passes when the referenced token has the same type (`typeOf` defaults to the default tree); a reference inside a larger value is allowed only in a dimension `calc()`. A value with `url(`, `@`, `;`, `expression` or a brace that is not part of a reference never passes.
- **`validateTokens(tree, { componentTokens? })`** checks a whole or sparse tree: `SUI-THEME-NAME`, then `SUI-THEME-TOKEN` for a path that is not in the default tree or the component tokens, `SUI-THEME-VALUE` for a wrong or injected value (state path `$.theme.tokens.<path>`), then `SUI-THEME-REF` over the tree merged onto the default tree and the component token defaults. `mergeOverDefaults(tree)` returns that merged tree.
- **Contrast.** `checkContrast(effectiveTree)` resolves `color.<tone>.base` with `color.<tone>.on` for every tone, and `color.text.base` with `color.surface.base`, through references to opaque literal colours. A pair below 4.5:1 is a `SUI-THEME-CONTRAST` warning naming both state paths; a pair that does not resolve to opaque literals is skipped. `contrastRatio(a, b)` is the WCAG ratio of two opaque colour literals.

### Token emission

`<ui-app-root>` is a generated component. Its static styles declare one custom property per leaf of the default tree
(`tokenSheet()`), each bound to the store: `--ui-color-text-muted: {{ cssValue($.theme.tokens.color.text.muted) }};`.
`cssValue` is a controller member that calls `toCssValue`, so a reference value (`{palette.blue.600}`) becomes
`var(--ui-palette-blue-600)` and the browser resolves the chain. The set is closed: a StateUI style binding needs a
static property name, so a token that is neither in the default tree nor declared by a shape is `SUI-THEME-TOKEN`.

Component tokens (E3.11) are added by `mountApp`: `componentLeaves(tokens)` gives the leaves and `ensureAppRoot(tokens)` defines a root whose sheet declares them too, bound the same way. A leaf that is not set renders no property (StateUI removes a custom property whose bound value is empty), so the CSS fallback written by the build applies; writing `$.theme.tokens.<group>.<token>` sets it and deleting the leaf restores the default. The tree starts with the empty group objects (`$.theme.tokens.button`) so a write has a parent. A sheet is fixed when a tag is defined, so `ensureAppRoot` returns the tag for the token set: the first set takes `ui-app-root`, a different set later takes `ui-app-root-2`, and so on.

A write to `$.theme.tokens.<path>` calls `setProperty` once on the host, synchronously, and reads no layout. Writing a
primitive changes one property in JavaScript; every role that references it follows in the browser.

The document's `theme.tokens` is checked by the `theme` document validator (`validateThemeTokens`, registered with
`validateDocument`): an invalid token stops `mountApp` with `SUI-THEME-NAME`, `-TOKEN`, `-VALUE` or `-REF` before render.
`DEFAULT_ACTIVE` holds the default `$.theme.active`.

### Overlays and `system`
An overlay is a sparse token tree of one kind; a kind may touch only some groups, so overlays cannot fight each other.
Code is in `src/core/theme/overlays/` (exported from `./core`) and `src/dom/theme/`.

| Kind | May touch | Shipped |
|---|---|---|
| `mode` | `color`, `elevation` | `light`, `dark`, `contrast` |
| `brand` | `palette`, `font.family`, `radius`, `icon` | `default` |
| `motion` | `motion` | `full`, `reduced` (every duration `0ms`) |

- **`SHIPPED_OVERLAYS`** holds them as JSON (`{ tokens }`). `light`, `default` and `full` carry the whole of their kind's groups, so
  applying one restores what another overlay of the kind changed. Every `mode` overlay merged over the default tree passes the
  reference and contrast checks.
- **`applyOverlay(store, kind, name, overlays)`** runs `store.apply('$.theme.tokens', overlay.tokens)` on a copy and sets
  `$.theme.active.<kind>` to `name`. Going back is applying the other overlay of the kind. An unknown kind or name, and `system`,
  return `SUI-THEME-OVERLAY` and change nothing. `buildOverlayCatalog(document.themes).overlays` is the shipped set plus the document's.
- **`validateThemeOverlay(kind, tree, { name?, statePath? })`** returns `SUI-THEME-OVERLAY` with the token path for a token outside the
  kind's groups, then the `validateTokens` checks on every value, then (for `mode`) `SUI-THEME-CONTRAST` warnings.
- **`themes`.** `"themes": { "acme": { "kind": "brand", "tokens": { } } }` adds overlays after the same validation. A name that is
  already a shipped overlay of the same kind (or `system` for `mode` and `motion`) is `SUI-THEME-OVERLAY`. The `theme` document
  validator (`validateTheme`) also checks that every name in `theme.active` is an overlay of its kind or `system`.
- **At start.** `mountApp` composes the active overlay of each kind over the default tree and puts the document's `theme.tokens` last,
  so the document's own values win at start. While mounted, a change to `$.theme.active.<kind>` (`store.set`, not only
  `applyOverlay`) applies that overlay. An unknown name is reported through `hooks.onError` and changes nothing. Applying an overlay
  replaces document token values in its groups.
- **`system`.** `$.theme.active.mode: "system"` applies `light` or `dark` from `prefers-color-scheme` at start and when the query
  changes; `motion: "system"` applies `reduced` or `full` from `prefers-reduced-motion`. `$.theme.active.<kind>` stays `system`.
  Setting an explicit name stops following; setting `system` again resumes. The system never selects `contrast`.
- **Environment.** `src/dom/theme/system.ts` is the only module that reads `matchMedia` (a test scans the source). `mountApp`'s `hooks`
  accept `matchMedia` (default `window.matchMedia`) so tests can fire a change; `dispose` removes the listeners. Without
  `matchMedia`, `system` means `light` and `full`.

### Node overrides

A node can carry `theme`, a sparse token tree like `theme.tokens`, to override tokens for its own subtree: `{ "component": "card", "theme": { "color": { "accent": { "base": "{color.success.base}" } }, "button": { "radius": "0" } } }`. A node may override semantic and component tokens only. The `theme` document validator checks every node of `app` and of each composed tree: a path in `palette`, `scale` or `font` is `SUI-THEME-LAYER` (naming the component and the node), a path that is not a token is `SUI-THEME-TOKEN`, a value of the wrong type or with injection characters is `SUI-THEME-VALUE`, and a reference to an unknown token, against the layer direction or in a cycle among the node's own overrides is `SUI-THEME-REF`. A `theme` that is not an object is `SUI-DOC-TYPE`. Each error's state path is the leaf below the node's `theme` (`$.app.children.a.theme.color.accent.base`).

`mountApp` gives `<sui-node>` the mapper from `nodeThemeMapper(componentTokens)`: a path becomes its `--ui-` custom property name and a value goes through `toCssValue` (a reference stays a live `var()`). The properties are written on that node's element, so they apply to the whole subtree including nested shadow roots; removing a key restores the inherited value, and a referenced token that changes later is followed. At run time the mapper skips a path that is not a known semantic or component token and writes a value with injection characters empty, so a state write cannot do what validation refuses.

Limits: a `var()` is substituted where it is declared. A semantic token that references another semantic token is resolved on `ui-app-root`, so a node override of the target does not change the referencing token below it; only components that use the overridden token directly, and unset component tokens (which fall back to their semantic default), follow an override. A node `theme` override of a `space` token is not carried into a nested density host, which re-declares `space.*` from the default expression.

## Build and test
Build `@punyts/state`, `@punyts/expression` and `@punyts/stateui` first.

```
npm run build
npm test
npm run test:browser
```

## License
MIT
