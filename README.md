# @punyts/stateui-app

Component system and app documents built on `@punyts/stateui`.

## Entry points
- `@punyts/stateui-app`: everything.
- `@punyts/stateui-app/core`: the DOM-free part; safe to import under plain Node.
- `@punyts/stateui-app/protocol`: the runtime message types, limits and structural validator; no DOM and no StateUI, so the preview host can import it.
- `@punyts/stateui-app/runtime`: `startRuntime` and the protocol (the code that runs inside the preview iframe).

## Error catalog, types and limits
All of it lives in `src/core/` and is exported from `@punyts/stateui-app/core`.

- **Error catalog.** `ERROR_CATALOG` owns every stable code (`SUI-DOC`, `SUI-NODE`, `SUI-STATE`, `SUI-LINK`, `SUI-ON`, `SUI-LAYOUT`, `SUI-THEME`, `SUI-LOCALE`, `SUI-LOGIC`, `SUI-BLUEPRINT`, `SUI-MODEL`, `SUI-PATTERN`, `SUI-PRESET`, `SUI-MODULE`, `SUI-INSTANCE`, `SUI-USES`, `SUI-ROUTE`, `SUI-SHELL`, `SUI-BUILD`, `SUI-RUN`, `SUI-SYNC` families) and its message template. `buildError(code, details)` returns a plain, serialisable `{ code, message, severity?, statePath?, component?, file?, line?, column? }`. `severity` is `"error"` (the default when absent) or `"warning"`; `isValid(errors)` ignores warnings. Templates take paths and names only (see `TEMPLATE_PLACEHOLDERS`), never content or data values.
- **Types.** `AppDocument` (`theme`, `themes`, `appThemes`, `locale`, `data`, `app`, `screens`, `start`, `composed`, `locales`, `logic`; `DOCUMENT_KEYS`), `Node`, and the reserved vocabulary as constants: `RESERVED_KEYS` (`component`, `children`, `layout`, `placement`, `theme`, `on`) and `PREFIXES` (`_`, `<-`, `__`).
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

- **Top-level keys.** `shared` (see below), `summary` (required; one line, at most `MAX_SUMMARY_LENGTH` = 120 characters; served by `ui_components_list`), `properties`, `events` and `commands` (lists of lower camel-case names), `layout` (true when the component lays out children, so a node may carry `layout`), `commandValues` (commands whose `value` must be a key of one of the component's `map` properties, such as `{ "show": "messages" }`; each name must be a declared command and each property a `map`, or `SUI-BUILD-SHAPE`). Keys are rows in the `SHAPE_KEYS` table (and `PROPERTY_KEYS` for a property): name, JSON type and rule. `category` (one of `COMPONENT_CATEGORIES`: `layout`, `navigation`, `forms`, `data`, `feedback`, `overlays`, `content`, `conversation`, `graphics`; anything else is `SUI-BUILD-CATEGORY`, whose message names the list) and `purposes` (three to eight phrases of what the component is for, each non-empty, on one line and at most 60 characters; `checkPurposes` holds the rule, a break is `SUI-BUILD-PURPOSES`) are what search reads; both are optional in the shape and `requireSearchKeys` (under Building a component library) makes them required. `tokens` and `tokenGroup` are described under Component tokens. `placement` is described under Layouts and placement. `childComponents` (a list of component names) limits the components the `children` slot accepts; on a `node` property it limits that slot. A node of another component is `SUI-NODE-CHILD`, reported by `validateDocument` with the state path and the accepted names (a composed component counts as the root component it resolves to). A shape component (`tier: "shape"`) is accepted only by a slot whose `childComponents` names it (a drawing's or a scene's, which draw it); in a slot with no `childComponents`, or at the root of the app or a screen, it is `SUI-NODE-CHILD` and the message says the slot takes no shapes. A composed tree may have a shape at its root.
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
- **Validators** (a closed set, in `VALIDATORS`): `oneOf` (a list of values), `pattern` (a regular expression of at most `MAX_PATTERN_LENGTH` = 200 characters; strings over `MAX_PATTERN_INPUT` = 10000 characters fail it), `regex` (a positive integer up to `MAX_PATTERN_LENGTH`: the value is itself a regular expression of at most that many characters that compiles and has no nested quantifier such as `(a+)+`; string properties only), `range` and `length` (`{ "min": n, "max": n }`, either bound optional; `length` takes non-negative integers). The graphics validators check the shape properties of a drawing or scene: `color` (`true`; a string: hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`, a token reference `{group.name}` or a paint name `^[a-z][A-Za-z0-9_-]*$`, at most `MAX_COLOR_LENGTH` = 100 characters; only the syntax is checked here), `pathData` (`true`; a string that `parsePathData` reads, not empty or blank, at most `MAX_PATH_DATA_LENGTH` = 4000 characters and `MAX_PATH_COMMANDS` = 2000 commands), `points` (`true`; an array of at most `MAX_POINTS` = 10000 `[x, y]` pairs of finite numbers; add `length` for an exact count), `vector` (`2` or `3`; an array of exactly that many finite numbers), `fields` (an object whose keys are only the listed fields, each `{ "type": "number" | "string" | "boolean" | "array" | "object", "values"?, "required"?, "validators"? }`, where `validators` may hold `color`, `pathData`, `points`, `vector`, `fields`, `fileRef`, `range` and `oneOf`, applying to the field type) and `fileRef` (`{ "types": [media types], "dataUrl"?: true }`; an object `{ id, name, size, type }` with a UUID `id`, a non-negative integer `size` and a `type` in `types`, and with `dataUrl` also a `data:` URL of an image type in `types`; string or object properties). A graphics validator passes a value of a type it does not apply to, for a property that lists several types (`["string", "object"]`). The catalog keeps every option, so `ui_component_get` shows the keys a `fields` object takes. An unknown validator is `SUI-BUILD-VALIDATOR`; options that are malformed or do not apply to the type are `SUI-BUILD-SHAPE`.
- **URL rule.** A `url` property accepts only `data:` images (`png`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `svg+xml`), `https:` URLs with a host (no user info), `#` targets and relative targets. Other schemes (`http:` among them), `//host`, backslashes, spaces and control characters are refused. A `pattern` validator also applies to a `url` and narrows it further (`"^(?:data:|https:|$)"` for images, `"^(?!data:|https:)"` for in-app links).
- **`parseShape(json, file)`** takes the file text or a parsed value and returns `{ shape, errors }`. It reports every problem (unknown keys are `SUI-BUILD-KEY`, a missing or bad summary is `SUI-BUILD-SUMMARY`, a default that does not fit is `SUI-BUILD-DEFAULT`, a bad pattern is `SUI-BUILD-PATTERN`) with the file; `shape` is set only when there are none.
- **`buildDefaults(shape)`** returns a fresh default state: every property that has a `default`.
- **`validateNode(shape, node, statePath)`** returns `SUI-STATE-*` violations with the state path: `SUI-STATE-UNKNOWN` (unknown property or a link to one), `SUI-STATE-SHARED` (an unsupported shared property), `SUI-STATE-REQUIRED`, `SUI-STATE-INVALID` (type, allowed values, validators, URL rule, icon name, slot not a node, map contents), `SUI-STATE-CONDITION`, `SUI-STATE-RUNTIME`, `SUI-LINK-ROW` and `SUI-NODE-NAME` (`$` or `__` keys). The optional fourth argument is `{ isIconName?, insideRow? }`. `<-name` links count as providing `name` and their value is not checked. `component`, `children`, `placement`, `theme` and `on` belong to the tree and are not checked here. Two codes exist for the icon component of `@punyts/stateui-components`, which raises them itself: `SUI-STATE-FILLED` (a warning: `filled` on an icon with no filled variant, so the outline is drawn) and `SUI-RUN-ICON` (an icon name found in neither the core set nor `$.runtime.icons`; reported through `@punyts/core`, nothing is drawn).

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

Allowed values: `gap` is `none`, `sm`, `md` or `lg` (default `md`; a container with no `layout` stacks its children as a column with the `md` gap); `align` is `start`, `center`, `end` or `stretch`; `wrap` is boolean (below the `sm` breakpoint every row wraps, and no row item is wider than its row); `cols`, `rows`, `col`, `row`, `span` and `rowSpan` are integers 1 to 12; `grow` is a number 0 to 12; `collapseBelow` is `sm`, `md`, `lg` or `xl`; `x`, `y`, `width` and `height` are literal dimensions (`4px`, `1.5rem`, `50%`, `0`), never `calc()` or a token reference.

A component that has no `layout` can declare the placement its children carry with a `placement` key in its `*.state.json`: a table of properties like `properties`, where `_` properties are content (tabs: `_tab`, `icon`, `badge`). A shape cannot have both `"layout": true` and `placement`.

`validateDocument` runs the `layout` and `placement` validators, which report `SUI-LAYOUT-TYPE`, `-SETTING`, `-VALUE`, `-FIELD`, `-PLACEMENT` and `-REQUIRED` for unknown or disallowed types, settings and fields, `SUI-LAYOUT-UNSUPPORTED` for a `layout` on a component whose shape does not support it, `SUI-LAYOUT-PARENT` for a `placement` under a parent that has neither a layout nor a placement shape (naming the parent), and `SUI-LAYOUT-ROOT` for a `placement` on the app root. An unknown setting's message names the settings of its layout type (`Unknown layout setting "wrap" at $.app.layout.wrap: the column layout takes "type", "gap", "align"`), and a `SUI-LOGIC-SHAPE` for an unknown key lists the keys allowed where it stands, so a writer picks the right key instead of guessing. Composed components are checked under `$.composed.<name>`. `validateNode` ignores `layout`; the layout validator reports it.

A component whose shape sets `"layout": true` marks the element that holds its children with `<div layout-host="" />` in its view; the build rejects a layout-capable component without a `layout-host`, and a `layout-host` in a component that does not support `layout`, as `SUI-BUILD-TEMPLATE` naming the view file. `<sui-node>` writes `layout`, `layout-<setting>` attributes and `--layout-<setting>` custom properties on the `layout-host`, and `placement` as attributes (`region="nw"`, `col="2"`, `row-span="2"`) on each child. The build prepends one stylesheet per layout type (`generateLayoutSheets`, `src/dom/layout/`), generated from the closed lists, to every layout-capable component, so changing `layout` or `placement` in state rearranges the children with no component code. The `layout-host` sets `container-type: inline-size`, so keep it a block-level box: a host that sizes to its content collapses to zero width.

**Breakpoints.** `BREAKPOINTS` is `sm` 480, `md` 768, `lg` 1024 and `xl` 1280 px of container width. A `grid`, `row` or `region` with `collapseBelow` stacks its children as one column in key order when its container is narrower than that width; without `collapseBelow` it never collapses. A container query cannot restyle its own container, so the sheet makes the component host `display: block; container-type: inline-size` and the queries restyle the `layout-host` inside it. The width compared is the host's content box, so the host's own padding is not counted. A nested layout host responds to its own component host's width.

**Shrinking.** In a `row` with at least one growing item (`grow` 1 or more), the growing items take the squeeze when the row runs short of space and the other items keep their content width, so a label, a badge or an amount beside a growing text is never cut. A `row` with no growing item shrinks every item, as plain flex does.

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
- A folder is root (`view.html` and `state.json`), composed (`composed.json`) or shape (`state.json` and locale files
  only), never a mix. A shape component is a mark a graphics renderer draws (a chart bar, a diagram node): it has no
  tag, module or CSS, only a catalog entry with `tier: "shape"`. In a `ComponentLibrary` it is a `ShapeEntry` (`{ tier: 'shape', shape }`, no tag):
  its nodes resolve over their shape's defaults and are validated, linked and localised as a root component's
  (`entryShape(entry)` gives the shape of a root or shape entry), but `<sui-node>` never renders one, the dispatcher
  (`componentTags`) hears no tag for it, and `mountApp` and `writeNode` refuse one outside a slot that names it with
  `SUI-NODE-CHILD`.
- Result: `{ components, errors }`. Each component is `{ name, tier, tag, group, files, locales }` (a shape component
  has no `tag`), sorted by name. A
  component with any problem is left out and its errors are reported; the others are still returned.
- Errors: `SUI-BUILD-FILE` (a file outside a component folder), `SUI-BUILD-ROLE` (an unknown role or a file name
  different from its folder), `SUI-BUILD-NAME` (a folder name that is not lower-case kebab), `SUI-BUILD-DUPLICATE` (two
  components with the same name, including a root and a composed one; both files named), `SUI-BUILD-TIER` (root and
  composed files in one folder), `SUI-BUILD-TIER-SHAPE` (a state file with a stylesheet or controller but no view) and
  `SUI-BUILD-MISSING` (a root component without its view or state file).

## Exposed paths of a composed component

`exposes` in a `*.composed.json` (or in a document's `composed` entry) maps an override path to what it changes: `"footer.children.confirm.tone": "Confirm button tone"`. It is the interface the minion reads in `ui_component_get`.

- `parseComposed(json, file)` returns the default tree without `exposes`, the `exposes` list and `SUI-BUILD-SHAPE` or `SUI-BUILD-EXPOSES` errors (an `exposes` that is not an object, a path with an empty segment, a description that is empty or not a string). `checkComposedExposes(parsed, library, file)` then reports each path that resolves nowhere, with the file. `buildLibrary` runs both and a component with an error gets no catalog entry or module.
- A path resolves when every segment is a key of the resolved default tree (nested composed components are expanded), or when the last segment is a property, slot, `children` or `layout` the nested node's shape declares (`body.children` on a form that has no children yet), or `on` / `on.<event>` for an event the shape declares.
- A document's `composed` entries are checked the same way by `validateDocument`: `SUI-DOC-EXPOSES` at `$.composed.<name>.exposes.<path>` (or `$.composed.<name>.exposes` when the value is not an object).
- `checkExposes(exposes, tree, library, composed?)` and `exposedPathResolves(resolved, path, library)` are the shared checks.

## Patterns

A pattern is a ready tree for a shell or a screen, found by search and copied into an app. Its file is `<name>.pattern.json` under `patterns/<kind>/<name>/`, where the kind is `shell` or `screen` (`PATTERN_KINDS`). `src/core/convention/patterns.ts` reads, checks and applies one.

- **Keys.** `summary` (one line, at most 120 characters), `purposes` (the `checkPurposes` rule of components), `tree` (a node), and optional `kind` (it must match the folder), `slots` and `params`. Paths in `slots` and `params` use the syntax of `exposes`, relative to the tree (`children.grid.pageSize`); there is no templating in the tree.
- **Slots** map a name to `{ path, description }`: the node where the agent adds content after the pattern is applied.
- **Params** map a name to `{ type, default?, required?, paths, description }`. `type` is one of `PATTERN_PARAM_TYPES` (`string`, `number`, `boolean`, `path`, a state path such as `$.data.products`); `paths` lists every tree path the value is written to. A param needs a `default` that fits its type, or `required: true`.
- **`readPattern(json, file, kind)`** returns `{ pattern?, errors }`. Each problem is `SUI-PATTERN-SHAPE` with its path; an unknown key names the keys allowed there.
- **`checkPattern(pattern, library, file)`** reports, as `SUI-PATTERN-SHAPE`: a component not in the library; a node of a root component that fails `validateNode` (the node error's code leads the reason; `$row` is legal inside a row template; a composed node is not opened); a child its slot's `childComponents` does not accept; a slot or param path that does not resolve (`exposedPathResolves`); a shell without exactly one `outlet`; a screen that holds one. `checkPatternPurposes(patterns)` reports a purpose two patterns share as `SUI-BUILD-PURPOSE-DUPLICATE`.
- **`applyPattern(pattern, values?)`** returns `{ tree?, slots, errors }`: a copy of the tree with each value (or its default) written at each of its paths, and the slots as `{ name, path, description }`. An unknown param (the message lists the params), a missing required param or a value of the wrong type is `SUI-PATTERN-PARAM`, and no tree is returned. The pattern is not changed.

## Resolving a node

`resolveNode(node, library, composed?, { path? })` turns a node into one merged, fully resolved tree. It is pure and
never throws; problems come back in `errors`.

- A root component's node is merged over the shape's defaults. A composed component's node is merged over its default
  tree; its values address nested nodes by path, such as `footer.children.confirm._title`.
- Every nested node (`children` and node-typed slots) is resolved the same way, so a composed component can contain
  another one.
- Merging is deep and sparse. Arrays are replaced whole; `children`, slot maps and the entries of a keyed `map`
  property (a table's `columns`) merge by key; `null` removes a default child, slot node or `map` entry
  (`children.table.columns.actions: null`). Where the shape does not make the place a `map` property, `null` is a value
  and stays one: a nullable property, `$.data`, or a `map` property set to `null` as a whole. A node that names a
  different component replaces the node under it.
- A composed file's `exposes` key is metadata and never reaches a resolved node. A node may still override a path that is not exposed; `exposes` is guidance, not a lock.
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
  skipped), `tree` is a copy without them. A target must start with `$.data` or `$row`, be the sync status (`$.runtime.sync`, `.mode`,
  `.status` or `.waiting`), or be a node reference (`^name.path`, `.path`) to an exposed runtime property; `$.server` or a path below it is `SUI-LINK-SERVER`
  (server-only), anything else is `SUI-LINK-TARGET`, an empty key is `SUI-NODE-NAME`. `linkedPaths` lists every linked property path (`statePath.key`); locale overlays and state snapshots exclude
  them.
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
| `navigate` | a screen name, such as `product` (not resolved) | the params, where `$row` and `$row.path` values are read at any depth |
| a component command | a node; absent means the node itself | the argument |

Targets: `^name.path` (nearest node, starting with the node itself, whose key is `name` or that is an instance of
composed component `name`, then the path below it), `.path` (own subtree), `$parent` (nearest ancestor whose component
declares the command), `$row` / `$row.path` (the record a row template's slot shows) and `$.app…` (absolute; in a
screen, `$.screens.{name}…` paths of that screen name nodes too, while in the shell they are plain state paths). Dot
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
`SUI-ON-EVENT`, `SUI-ON-COMMAND`, `SUI-ON-VALUE` (a literal `value` of a command the target lists in `commandValues` that is not a key of that map, read from the node or its default; a `$` path or `{{ }}` value is not checked) and `SUI-ON-TARGET` errors with the state path. `parseTarget` and `resolveTarget` are
exported so the runtime dispatcher uses the same rules.

## Document validation

`validateDocument(document, catalog, options?)` runs every structural check without a DOM and returns
`{ valid, errors }`. `catalog` is a `ComponentLibrary` or the content of `catalog.json` (`libraryFromCatalog` converts
it). `valid` ignores warnings. The function never throws; every error carries a state path (`$` when it concerns the
whole document). `options.isIconName` checks icon names against the server's `icons.json`. `options.mode` (`standalone`,
`persisted` or `full`) says how the app keeps its state: in `standalone` and `persisted` mode there is no app server, so
every string of the document that names `$.server` or a path below it (an `on` target, a command value) is
`SUI-DOC-SERVER`; `full` or no mode allows it.

Order of checks:

1. A value that is not an object, or cannot be serialised, is `SUI-DOC-SHAPE`.
2. The closed limits (nodes, depth, bytes, data). A breach returns only the limit errors and nothing else runs, so an
   oversized document is never resolved.
3. Root keys and their types (`SUI-DOC-TYPE`; `runtime` and unknown keys are `SUI-DOC-KEY`), and a missing `app`
   (`SUI-NODE-MISSING`).
4. Integer-like keys in `children`, `options`, `columns`, `items`, `steps`, `messages` and every object under `data`
   (`SUI-DOC-ORDER`). The `records` or `items` of a node that has an integer `total` are exempt: a paged record view
   reads them by position, so the key is the position and key order carries nothing (`query` writes them this way).
   Screens (`screens`, `start`) are checked here too: a screen name is a part name, an entry is `{ title?, params?,
   root }` with params as typed declarations (`FIELD_TYPES`), `start` is required with screens and names one, and has
   no meaning without them. Each problem is `SUI-DOC-SCREEN` at `$.screens.{screen}` or `$.start`. `route` is not a
   document key: `$.route` is the store branch of navigation (see below).
5. The `app` tree, each screen's `root` (at `$.screens.{screen}`, no `.root` segment) and each document `composed`
   tree: every component resolves, composed cycles, reserved names, each
   merged node against its shape (`validateNode`), and `<-` links. A `$.data` target must exist, a node reference must
   reach a property its component declares, and a node reference must reach an exposed runtime property (`SUI-LINK-MISSING`). Exposed properties are runtime
   branches no link can have as its own key, so links cannot loop through node references.
6. The registered plug-in validators, whose errors are merged.

`registerDocumentValidator(name, (context) => BuildError[])` returns a function that removes it. `context` holds the
`document`, the `library` and the resolved `tree` (`node`, `instances`). Validators run in registration order; the `on`
validator (`validateOn`) is registered by default, then `layout`, `placement`, `step`, `logic` and `route`; the theme and
locale validators of epic 3
register the same way. A validator that throws is reported as `SUI-DOC-VALIDATOR`. The `step` validator warns
(`SUI-STATE-STEP`) when a node whose component has the number properties `min` and `step` (the number field) writes both
as numbers with `step` above 0 and `min` not a multiple of `step`: the field counts its values from `min`, so `min: 0.01,
step: 1` refuses 1250. Use `min: 0` or a step that divides `min`. It is a document validator because `validateNode`
sees one property at a time and the rule relates two.

Node fields inside map items (a table column's `cell`, a `descriptionList` item `node`) are resolved, validated against
their component's shape and checked for `on` and links like any other node; those of a `row: true` field are row
templates. `nodeChildren(node, path, shape)` (from `@punyts/stateui-app/core`) lists the nodes below a node this way.

A runtime property that still has its default in a resolved node counts as not set; only a node that gives it another
value is `SUI-STATE-RUNTIME`.

Layouts, node overrides, ordered keys, `on` entries and the node limit cover the screens as they cover `app`.
`core/route/` holds the route: `ROUTE_PATH` (`$.route`), `OUTLET_COMPONENT` (`outlet`), `screenPath(name)`
(`$.screens.{name}`), `findOutlet(tree, path)` (the path of the first `outlet` node), `RouteState` (`{ screen, params }`), `paramDefaults(declarations)`
and `initialRoute(document)`, the `start` screen with copies of its params' defaults (undefined without screens).

**Navigating.** `{ "command": "navigate", "target": "product", "value": { "id": "$row.id" } }` moves `$.route` to a
screen, in an `on` entry and in logic (browser and server alike). `routeTo(screens, screen, params)` gives the route it
writes in one commit (the defaults of the screen's params with the given ones over them) or the reason it refuses: no
such screen (with the nearest names), params that are not an object, a param the screen does not declare, a value
that does not fit its type or validators, or a required param left out. In logic a refusal fails the transition
(`logic.failed`); in `on` it is `SUI-RUN-ON-COMMAND`. The browser runs it through the dispatcher's `navigate` option,
which `mountApp` sets for a document with screens; logic hosts give `screens()`. The `route` document validator checks
every `navigate` of the shell, the screens and the logic with `checkNavigate`: `SUI-ROUTE-SCREEN` for a target that
names no screen, `SUI-ROUTE-PARAMS` for literal params that do not fit (a `$`, `^` or `{{ }}` value is checked by name
only; a command with `from` by screen only). A node whose component has a string `screen` property (`link`,
`menuItem`) is checked the same way, with its `params`: the errors are at the node's `.screen` or `.params`. A
component command named `navigate` is shadowed by the system command. An `on` command in a screen whose target is
under `$.app` (a toaster of the shell) is found from the shell's root.
The `outlet` validator checks where the screens show (`SUI-SHELL-OUTLET`): in an app with screens the resolved shell
holds exactly one `outlet` node (one a composed component brings counts; each extra one is an error at its path, none is
an error at `$.app`), and no screen holds one. An app without screens is not checked.

## Dispatching `on` in the browser

`createDispatcher({ host, store, library, instances?, rootPath?, roots?, hooks?, navigate? })` listens on `host` (the
element the store is mounted on) and runs the `on` entry of the node that raised an event. It returns `{ dispose() }`.
`roots` are more roots whose nodes raise events (`mountApp` passes each screen's `$.screens.{name}`); a node's chain and
absolute targets start at the root that holds it, and app events still run on `rootPath`.

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

## Logic

The `logic` root of a document holds **machines**, **rules** and decision **tables** that act on state changes with built-in commands, so a
Save button saves and a count follows its records without an agent in the loop.

```json
"logic": {
  "machines": {
    "addContact": {
      "state": "$.data.flags.phase", "initial": "editing",
      "transitions": [
        { "from": "editing", "when": { "path": "$.data.flags.saved", "is": true }, "to": "saving",
          "do": [ { "command": "set", "target": "$.data.flags.saved", "value": false },
                  { "command": "save-data", "into": "$.data.contacts", "value": { "form": "^entry" }, "as": "save" } ] },
        { "from": "saving", "when": { "result": "save", "is": "accepted" }, "to": "editing",
          "do": [ { "command": "reset", "target": "^entry" }, { "command": "notify", "target": "toast", "value": { "text": "Added" } } ] },
        { "from": "saving", "when": { "result": "save", "is": "rejected" }, "to": "editing" }
      ]
    }
  },
  "rules": {
    "count": { "when": { "path": "$.data.contacts" }, "do": [ { "command": "set", "target": "$.data.stats.count", "value": "{{ size($.data.contacts) }}" } ] },
    "noDrafts": { "when": { "path": "$.data.contacts.{id}", "if": "$trigger.name == 'draft'" }, "do": [ { "command": "reject", "reason": "Draft is not a name" } ] },
    "window": { "when": { "path": "$.app.children.contacts.window" }, "do": [ { "command": "query", "from": "$.data.contacts", "sort": "name", "window": "$trigger", "into": "^contacts" } ] }
  }
}
```

- **Triggers.** `path` is a state path whose steps may be `*` (one segment) or `{name}` (one segment, captured); it
  matches a change at, below or above it. `result` is the `as` name of a `save-data` or `delete-data` command of the
  same machine (or a `call`). `is` compares the value (or the result status, `accepted` or `rejected`), `was` the value
  before the change (`$previous`), `if` is an expression. `debounce` (milliseconds) fires a path trigger once the path
  has been quiet that long, with the last change. `after` (milliseconds, a machine transition with `from` only) fires
  that long after the machine entered the state; an `after` transition that stays in its state repeats.
- **Machines.** The current state is the value at `state` (`initial` is written when it has none). The first
  transition of the current state whose trigger matches fires; `from` absent matches any state, `to` absent keeps it.
- **Tables.** `tables.<name>` has `when`, `inputs` (names to values, read once and named `$<name>` in the rows) and
  `rows` of `{ match?, if?, do }`. The first row whose `match` (input names to values) and `if` hold runs its
  commands; a row with neither is the default and must be last. A table fires once per chain.
  ```json
  "shipping": { "when": { "path": "$.data.order" }, "inputs": { "country": "$.data.order.country", "total": "$.data.order.total" },
    "rows": [ { "match": { "country": "NL" }, "if": "$total >= 50", "do": [ { "command": "set", "target": "$.data.order.shipping", "value": 0 } ] },
              { "do": [ { "command": "set", "target": "$.data.order.shipping", "value": 5 } ] } ] }
  ```
- **Commands.** `set`, `merge`, `copy`, `toggle`, `increment`, `reset` (the document values with shape defaults),
  `save-data` (a record into a data map, with a new key or `key`), `delete-data`, `pull-data` (a record into a form),
  `query` (sort, filter and window a data map into a list's records, keyed by position (the key is the position in the sorted, filtered result, so a window
  starting at 20 has the keys `20`, `21`, ...; the record's own key goes in its key field), and its `total`), `notify` (app
  event `notify.<name>`), `emit` (to the server), `call` (a server procedure `target` with `value`; machines only and
  Full mode only, `SUI-DOC-SERVER` elsewhere; the answer comes back as the result `as`, with `$result.value` or
  `$result.reason`), `navigate` (moves `$.route` to the screen `target`, with `value` as the params; see the route
  below) and `reject`. A rule whose only command is `reject` is a **guard**:
  it refuses the change. Trigger and command paths may be under `$.app`, `$.data`, `$.server`, `$.screens` and `$.route`.
- **Values.** `{{ expression }}` templates; `$.path`, `^node.path` (a node key or composed name, unique in the current
  screen, else in the shell; while validating, in the shell, else among the screens), `$trigger`,
  `$previous`, the table inputs, `$result`, `$key`, `$record` and the captures; the sources `{ "form": "^node" }`, `{ "record": "$.data…" }` and
  `{ "pick": … }`. Functions: `size`, `keys`, `values`, `sum`, `min`, `max`, `count`, `includes`, `first`,
  `last`, `empty`, `coalesce`, `lower`, `upper`, `trim`, `join`, `round`, `floor`, `ceil`, `abs`, `number`,
  `string`, `slice`, `now`, `today`. `slice(value, start, end?)` cuts a string, or the items of an array or
  map, like JavaScript's `slice` (negative positions count from the end); `now()` is the UTC time as an ISO string and
  `today()` the local date as `YYYY-MM-DD`, for a "due today" comparison.
- **Deriving at start.** `engine.start()` first runs, once, each rule or table that only derives values: every
  trigger a `path` without `was` or `after`, every command `set`, `merge`, `copy` or `query`, and no machine.
  Each fires for every concrete path its trigger matches that has a value (`$.data.products.{id}.price` fires for each
  product), in chain order, traced with the cause `start`, so a count or a total is right before the first change.
  Rules that notify, toggle, save, call or navigate, and those with `was`, wait for a change. `start({ derive: false })`
  skips the pass and `engine.derive()` runs it later (the app server does so once an instance is attached to its
  shared datasets, so the derived values are written through).
- **All or nothing.** A transition's commands run on a working copy and commit together. A failing command commits
  nothing and raises `logic.failed` (`{ machine, from?, command?, reason }`) on the root node. A machine or rule fires
  at most once per chain, a chain stops at depth 8, and command results start new chains after the current one.
- **Where it runs.** `mountApp` runs it in the browser for Standalone and Persisted apps, for the store's own
  (untagged) writes only, so writes that arrive through sync are not run again; logic writes carry the origin
  `logic` and are synced. A refused change is undone. Full apps run it on the app server's authority
  (`@punyts/stateui-mcp`). `logicRunOrder(logic)` lists the units in the order the engine runs them, with the paths
  each reads and writes, for build tools. The engine itself (`createLogicEngine`, `createLogicIndex`, `readLogic`) has no
  environment and runs on any `LogicHost`; the host's `schedule(ms, run)` (returning a cancel function) runs the timers
  and its `call(name, payload)` answers `call` (with none, a call is rejected). Its optional `guard(change)` is asked
  after the guard rules: its reason refuses the change, and `save-data` or `delete-data` gets it as the `rejected`
  result (the app server checks shared dataset records against their model this way). Timers live in memory: they are armed
  again when the engine starts and `engine.stop()` cancels them.

## App blueprints and owner parts
The owner tree (`knowledge-base/design/stateui-owner-tree-and-tools.md` in AI Minion) splits an app into a blueprint and
the owner's parts. `src/core/blueprint/` holds their types and the blueprint reader; `src/core/assemble/` assembles and validates an app.

- **Types.** `AppBlueprint` (`title`, `uses`, `start`, `shell`, `screens`, `logic`, `locales`), `ThemePart`
  (base `tokens`, `overlays` by name with a `kind` of `OVERLAY_KINDS`), `LogicModule` (`needs`, `params` and the logic
  units), `ModelPart` (`fields`), `DatasetPart` (`model?`, `records`), `ComposedPart` (a tree, `exposes` and the search
  keys) and `PatternPart` (read and checked under Patterns). `PART_KINDS` lists the owner roots and `PartRef` names a part by kind and name;
  the immutable `id` belongs to the storing adapter.
- **Declarations.** Screen params, module params and model fields are `{ type, default?, required?, validators? }`, with
  `type` one of `FIELD_TYPES` (`string`, `number`, `integer`, `boolean`, `array`, `object`, `any`, `url`) and the
  library's closed validator names.
- **Names.** `isPartName(value)` accepts `^[a-z][a-z0-9-]{0,62}$`, which is never integer-like. `slugifyName(raw, taken)`
  lower-cases, turns other character runs into one `-`, prefixes a leading digit with `n`, keeps 63 characters and adds
  `-2`, `-3`, … while the name is taken.
- **Reader.** `readBlueprint(json)` returns `{ blueprint, errors }`, with `blueprint` only when there are no errors. Each
  problem is a `SUI-BLUEPRINT-SHAPE` naming its path: an unknown key, `uses` of the wrong shape (theme names that are not
  part names or listed twice, a binding that is neither `{ dataset }` nor `{ model, scope: "persona" }`, a binding name that
  is not a key name, a module name that is not a part name), a shell or screen root that is not a node, a screen without
  `root`, no screens, a screen name that is not a part name, a `start` that names no screen, and params that are not typed
  declarations. `declarationProblems(value, path)` checks one typed declaration for the blueprint, models and modules: its
  keys, a type of `FIELD_TYPES`, a boolean `required`, validators that are known, well formed (their own `parse`) and
  apply to the type (`pattern` on a `number` does not; `any` takes every validator), and a default that fits the type
  and its own validators. `isKeyName` is the rule for binding, param and field names (`^[A-Za-z_][A-Za-z0-9_]*$`). The contents of `logic`, the parts `uses` names and the shell's `outlet` are checked when the app is
  assembled.
- **Assembling.** `assembleApp(blueprint, parts, { library? })` takes a `PartSource` (plain maps of `themes`, `modules`,
  `models`, `datasets` and `components` by name; no IO) and returns `{ document, errors, uses }`. The document is today's
  `AppDocument` plus `screens`: `app` is the shell, `theme.tokens` and `themes` (the overlays) come from the first of
  `uses.themes` (`appThemes` holds every listed theme by name), `data.{binding}` holds the bound dataset's records (for a persona binding, the model's defaults over an
  empty map: `applyDefaults(model, {})`), `composed` holds
  the owner components that a node of the shell, a screen or another used component names (their trees with `exposes`,
  without the search keys; an owner component wins over a library component of the same name), and `locales` are the
  app's own. `logic` is the app's own units followed by each module of `uses.logic`, instantiated with its params
  (`instantiateModule`, units named `{module}:{unit}`). Each need of a module must be bound under its own name
  (`SUI-USES-NEEDS`) to data of the model it names: a dataset's `model` or a persona binding's (`SUI-USES-MODEL`, also
  for a dataset with no model). Two modules that need one name must name one model (`SUI-USES-MODEL`, naming both) and
  then share the binding. A param that does not fit is `SUI-MODULE-PARAM` at `$.uses.logic.{module}.params.{name}`. A
  module with any of these errors adds no units, and its errors carry `part` (the module). A part named in `uses` that the owner does not have is `SUI-USES-MISSING` with up to
  three nearest names (`nearestNames`); with a `library`, so is a component name in neither. `uses` lists each part the
  app reads (`{ kind, name }`) once: themes, data with each binding's model, modules with the models they need, and
  components. Pure: the result shares nothing with the inputs, so changing one theme part shows
  in every app assembled from it.
- **Validating.** `validateApp(blueprint, parts, catalog, { name?, ...ValidateDocumentOptions })` assembles and runs
  `validateDocument` on the assembled document, which checks the shell at `$.app` and each screen at
  `$.screens.{screen}`. Each error gains `part`: the owner component (`$.composed.{name}`), the first theme
  (`$.theme`, `$.themes`), the dataset of a binding (`$.data.{binding}`), the logic module of a binding or param error
  (the `part` assembling gave it) or the app. A component already reported
  `SUI-USES-MISSING` is not reported again as `SUI-NODE-UNKNOWN`. The assembled document carries `start`. With
  `mode: "persisted"` each binding to a shared dataset is `SUI-SYNC-SHARED` at `$.uses.data.{binding}`
  (`checkSharedData(blueprint, mode)`): only the app server keeps a shared dataset in step across apps, so it needs
  Full mode; persona bindings are allowed in every mode.
- **Converting** (`src/core/convert/`). `splitDocument({ name, document, snapshot?, taken? })` turns one stored app of
  the old single-document form into owner parts: `{ app?: { name, blueprint }, themes, models, datasets, components,
  renamed, report }`. Pure, so each adapter runs it over its own storage.
  - Names become slugs (`slugifyName`); a name in `taken` (by part kind) or already given in the run gets `-2`, `-3`, …;
    the stored name stays as the blueprint's `title`. `renamed` lists each name that changed.
  - With one hidden-strip `tabs` (`strip: "hidden"`), the shell is the app with an `outlet` in its place (keeping its
    `placement`), each tab a screen titled by its `_tab`, and `start` the strip's `active` tab. An `on` command that
    sets the strip's `active` to a tab name becomes a `navigate` to that screen. Without one, the shell is a bare
    `outlet`, which takes the root's app-event `on` entries, and the whole tree is the screen `main`.
  - State paths into moved nodes, whole values or inside `{{ }}`, follow them to `$.screens.{screen}` in nodes and
    logic. The document's locale overlays split the same way: a tab's part goes to its screen, the rest stays the app's.
  - `theme.tokens` and `themes` become a theme named after the app; `theme.active` and `locale` are choices, not
    definitions, and are dropped.
  - Each key of `data` becomes a dataset `{app}-{key}` with a model of the same name (`inferModel`), bound back under
    the key. The snapshot's `data` wins over the document's; its articulation under `app` is dropped. A list becomes
    records keyed by their `id` (a slug when the id is integer-like or repeated, `r{n}` without one).
  - `composed` becomes owner components (`parseComposed`), and the nodes that name them follow the new names.
  - `report` lists `{ path, reason }` for what does not convert, and then no parts come back: a document that already
    has screens, a second hidden-strip `tabs`, a strip that logic or a node refers to other than through those `set`
    commands, a strip with its own `on` or a `<-` link, data that holds no records (a scalar, a list of scalars, an
    object of scalars) or integer-like record keys, and a composed tree or inferred model that does not read.
    The app's `id` and `sync` mode are the adapter's to keep.
- **Models** (`src/core/models/`). A model part is `{ fields }`, typed declarations by field name in order (`date` and
  `enum` are not types: a date is a `string` with a `pattern`, an enum a `oneOf`). `readModel(json)` returns
  `{ model, errors }`, each problem a `SUI-MODEL-SHAPE` at its path (`$` is the model): an unknown key, missing
  `fields`, a field name that is not a key name and every problem `declarationProblems` finds.
  `queryRecords(records, { filter?, sort?, window? }, scope?)` is the evaluator of the `query` command on its own: it
  returns the window's `[key, record]` rows, the window's `first` and the `total` that matched, and throws a `LogicError`
  for a filter that does not evaluate (the server queries dataset parts with it).
  `checkRecord(model, record, key?)` and `checkDataset(model, records)` give `SUI-MODEL-FIELD` with the record key and
  the field for a value of the wrong type or failing its validators (the shapes' own `fitsType` and
  `passesValidators`), a required field without a default and no value, and a field the model does not declare; a
  field set to null counts as absent. `applyDefaults(model, record)` returns a copy with the defaults of absent and null
  fields, in field order, then the record's other keys. `inferModel(records)` (an array or records by key) types each
  field from the samples: an integer and a fraction make `number`, other mixes and only nulls make `any`, every field
  optional; names are kept as found, so one that is not a key name fails `readModel` until the caller renames it.
- **Logic modules** (`src/core/logic/modules.ts`). A module is `{ needs, params, machines?, rules?, tables? }`: logic
  over data, with the data it needs by binding name (`{ "bag": { "model": "bag-line" } }`) and typed params.
  `readModule(json)` reads the units as `readLogic` does (`ReadLogicOptions.root` `$`, so paths are the module's
  own) and the needs and param declarations as `SUI-LOGIC-SHAPE`. A module names no node: a `^name` reference, a
  `$.app` or `$.screens` path and `navigate` are `SUI-MODULE-NODE`. A `$.data` path whose first segment is not a
  need (or is a capture, `*` or missing) is `SUI-MODULE-NEEDS`; `$params.{name}` of an undeclared param is
  `SUI-MODULE-PARAM`. `increment` and `save-data` without `key` are `SUI-MODULE-ONCE` warnings, because a module
  runs once per open instance of an app and should write derived values only.
  `instantiateModule(module, params, { name })` gives one app's copy: each value is checked against its declaration (a
  missing required param, a misfit and an undeclared name are `SUI-MODULE-PARAM`), defaults fill the rest, and every
  `$params.{name}` is replaced by its value, so the engine needs no new variable and params are constant. A string that
  is exactly `$params.{name}` becomes the value (any type); inside `{{ … }}`, `if` and `filter` it becomes a JSON
  literal (strings JSON-escaped; an array or object there is an error). Unit names and `as` results (with the
  `result` triggers that wait for them) get the prefix `{name}:` (`MODULE_UNIT_SEPARATOR`; unit names have no rule
  of their own, and a dot would read as a path step in `$.logic.rules.cart:totals`). The units join the app's in one
  `LogicDocument` and take their place in the run order like any other.

## Starting an application: `mountApp`

`mountApp(host, document, library, hooks?)` is the single entry point (`src/dom/mount/`, exported from
`@punyts/stateui-app`, not from `./core`). `library` is a `ComponentLibrary` (`libraryFromCatalog(catalog)` builds one) and
its component modules must be registered already, for example with the build's `registerAll()`. `hooks` is the
dispatcher's `{ onEmit?, onError?, transferFile? }`; `startRuntime` sets `transferFile` (see Files below).

```ts
const { store, errors, dispose } = mountApp(host, document, library, { onEmit });
```

1. `validateDocument` runs first. Any error (a warning does not count) stops the run: `store` is `undefined`, `errors`
   holds everything found with state paths, and nothing is added to `host`.
2. `composed` is resolved against the library and `app` and each screen's `root` are resolved node by node (a screen at
   `$.screens.{name}`, where a node reference resolves within that screen, as the validator checks it). `<-` properties are removed from the
   tree, node references are resolved to the exposed runtime properties they reach, and the links become store aliases
   (`applyLinks`) once the store exists. A link that cannot be resolved or applied stops the run.
   A `$row` link inside a row template is the exception: it has no target until a record view (or a component such as
   `descriptionList`) makes a runtime copy of the template, so it is not applied; the `<-key` stays in the tree as
   written and the component passes the template to `resolveRowLinks`.
3. The store holds `{ theme, data, locale, app, runtime }`, and for a document with screens `screens` and `route`:
   - `theme` is `{ tokens, active }`: the document's `theme.tokens` over the default tree (every token, so a write patches one custom property) and `active` as `{ mode: "light", brand: "default", motion: "full" }` unless the document gives other names. See Token emission below.
   - `data` is a copy of the document's `data`; the document itself is never changed.
   - `locale` is the document's, `"en"` by default.
   - `runtime` is never read from the document: `nodes` (`{}`), `icons` (`{}`, written by the host's `load` message) and
     `empty` (`{}`, the shared empty record). `$.runtime.empty` is protected, so nothing can write into it.
   - `screens` holds each screen's resolved root by name, without its `<-` links.
   - `route` starts as `initialRoute(document)` and is protected: only `navigate` (an `on` entry, the logic,
     `MountedApp.navigate` or the runtime's `command` message) writes it, through `writeRoute`.
4. `<sui-node>` gets a resolver (component name to the root component's tag) and options (`reflect(name)` from the shapes'
   `reflect: true` properties). The store is mounted on `host`, the `on` dispatcher is attached and `<ui-app-root>`
   is appended; it holds `<sui-node state="$.app">`. If the library registers its own `ui-app-root` first, that one is used (it then carries no token properties).
   With screens, `startScreens` shows the screen `$.route.screen` names: on its first visit a container
   (`<div data-sui-screen="{name}">` holding `<sui-node state="$.screens.{name}">`) is appended to the element of the
   shell's first `outlet` node (the host when there is none), and a screen that is left gets `hidden`, so its elements
   and articulation (typed values, open panels) are there on the way back. The shell is never re-rendered.
   `visibleScreen()` says which screen shows and `navigate(screen, params?)` moves the route (it returns why it cannot).
   `writeNode` and `removeNode` take paths below a screen's root as well as below `$.app`.
   The `route` step (`dom/route/`, `ROUTE_STEP`) keeps `$.route` in the window's URL fragment, as
   `#/product?id=p42` (`formatFragment` and `parseFragment` in `core/route/`: params equal to their default are left
   out, and each param is read back in its declared type). A fragment that names a screen the app can show is the
   first route; one that names an unknown screen or params that do not fit starts at `start` with a warning. The start
   route replaces the fragment, each navigation pushes a history entry, and the back and forward buttons (`popstate`)
   and a hash typed by hand (`hashchange`) navigate. `dispose` removes the fragment the step wrote.
   `MountOptions.route: false` leaves the URL and the history alone, for a host page whose URL the app must not touch.
   With it on or off, an element of the app raises `sui-navigate` (`NAVIGATE_EVENT`, bubbling and composed, detail
   `{ screen, params? }`, as `link` and `menuItem` do for a `screen`) to navigate; the app stops the event, and a
   refusal is a warning that changes nothing.
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

**Screens.** Each screen's text has its own overlays: a screen's `locales.<code>` (`screens.home.locales.de`) is relative to its root `$.screens.{name}`, as the document's `locales.<code>` is relative to `$.app`. `app.screenBaseOverlays` holds the base content of each screen by name. `switchLocale(store, code, overlays, screens)` takes the screens' overlays by screen name, then by language, as a fourth argument and applies each to its root, whether the screen is shown, hidden or not mounted yet, so a screen shown after a switch already has the language. A code that neither the shell nor any screen has is `SUI-LOCALE-UNKNOWN`. The `locale` validator checks every screen's `locales` against that screen at its own path, and `readBlueprint` accepts `locales` on a blueprint screen.

`extractBaseOverlay(tree, linkedPaths)` builds that overlay from a resolved tree (arrays are not searched; an overlay cannot address an array item). `validateLocaleOverlay(code, overlay, app, { linkedPaths, library })` rejects a leaf that is not a `_` text property or inside a `_` content map (`SUI-LOCALE-CONTENT`), a linked property (`SUI-LOCALE-LINKED`) and a path the application does not have (`SUI-LOCALE-PATH`); with `library`, each `_` leaf must be a `kind: content` property of its component.

**Component overlays and the application overlay.** A component ships one overlay per language as `<name>.locale.<code>.json`, next to its other files. A root component's overlay holds `_` content properties of its shape, including map items (`options.<key>._label`, `columns.<key>._title`). A composed component's overlay is relative to its default tree and may reach any content path in it (`children.status.options.open._label`, `children.tabs.children.one.placement._tab`). `buildAppOverlay(code, resolvedApp, componentOverlays, appOverrides, { library, composed, instances, linkedPaths })` assembles the overlay for the whole application: each node gets its root component's overlay and the overlay of every composed component it was expanded from, so a composed component used three times is translated once. The document's `locales[code]` wins. With `library`, a component overlay replaces only content that still holds the component's default, so text the author wrote is never overwritten. Inside a content map such as `_errors` every text entry is content whatever its key is called, so `_errors.required` is translated while an entry the author changed is kept. Without `instances`, composed overlays are not applied.

`validateAppLocale(code, resolvedApp, componentOverlays, appOverrides, options)` returns the errors of the document's own overrides and a `SUI-LOCALE-MISSING` warning for each content path the language does not translate, in tree order, naming the language and state path. It lists at most `MAX_MISSING_PER_LANGUAGE` (50) and adds one `SUI-LOCALE-MORE` warning that counts the rest. Empty text is not counted, and a language with overlays for only some components is allowed. `validateDocument` runs the registered `locale` validator, which checks `document.locales` for `SUI-LOCALE-CONTENT`, `SUI-LOCALE-PATH` and `SUI-LOCALE-LINKED`; it cannot report missing content, because a document does not carry component overlays, so the server calls `validateAppLocale` for that.

**Nodes created later.** `registerLocaleStep(componentOverlays)` registers a mount step. After `mountApp` it builds the overlay of each language (the base overlay for the mounted content, `buildAppOverlay` for the rest) for the shell and for each screen, and watches `$.app` and every `$.screens.{name}` (`createNodeLocale`'s `root` option names the root one localizer keeps). `handle.screenOverlays` holds the screens' overlays. A node written later (a keyed entry added to `children`, a `children` map added to a node, a composed node, a keyed entry such as a static select option) gets its component's overlay for the current `$.locale` in the same write, before it renders. Each language's overlay learns the new content, so `handle.switchTo(code)` keeps it translated and switching back restores the original text; a delete removes the node from the overlays. Text the author wrote that differs from the component default is kept, and the document's `locales` overrides for the path apply. Code that creates nodes itself (list and table rows, modals) calls `handle.nodes.prepare(path, node, instances?)` immediately before writing and writes what it returns; a composed node needs its `ResolveResult.instances`. Writing over an existing node is an update, not a creation, so add nodes under new keys.

## State snapshot

Code is in `src/core/snapshot/`, exported from `@punyts/stateui-app/core`. A host calls it for the `state` of a `load`
message.

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
- **Persona instances** (`instance.ts`). An `AppInstance` is `{ app, screens, route?, theme?: { active }, data? }`:
  what one persona did in an app, shaped like a `StateSnapshot` plus each screen's articulation by name.
  `MountOptions.instance` lays it over the definition before the store exists (`layInstance`), and the document is
  never written. In `app` and `screens` only keys the definition has are laid (an object recurses, any other value
  replaces); content, `<-` links and node structure never are, and values of nodes or screens the app no longer has
  are dropped silently. `data` is laid the same way but takes new keys (a persona's records). A route to a screen the
  app no longer has, or whose params no longer fit, opens the start screen, and an active overlay name or kind the app
  no longer has keeps the document's; each is a `SUI-INSTANCE-STALE` warning in `MountedApp.errors`. The theme step
  lays the kept names over the document's (`MountContext.instanceActive`).
- **`diffInstance(definition, current)`** returns only what differs, as a sparse object: objects recurse, other values
  (arrays whole) come from `current`, and a key `current` no longer has is `null`. Equal states give `{}`.

## Sync modes and offline use

An app is mounted in a mode (`MountOptions.mode`, the `load` message's `mode`): `standalone` (the browser store is the
authority), `persisted` (a statenet is) or `full` (an app server with server logic is). The runtime itself has no
network: the host runs the `@punyts/state-sync` client, writes the authority's changes in with `write` and sends the
runtime's `change` messages on. `$.runtime.sync` holds `{ mode, status, waiting }`, with `status` one of
`standalone`, `connecting`, `online` and `offline` and `waiting` the number of changes not yet acknowledged, so a
linked component can show "Offline – 3 changes waiting". A change the authority rejects comes back as the
`sync.rejected` app event with `{ path, reason }`, handled by an `on` entry of the root node. `$.server` is
server-only: a link into it is `SUI-LINK-SERVER`, and outside `full` mode any mention of it is `SUI-DOC-SERVER`.

## Preview runtime and message protocol

Code is in `src/runtime/`. `protocol` holds the closed set of messages and the validator; `startRuntime` is the code that runs inside the preview iframe (E7.1).

**Messages.** Every message is `{ v: 1, nonce, type, ...fields }` (`PROTOCOL_VERSION`). Host to runtime: `load` (`document`, optional `state` = `{ data, app }`, `instance` (an `AppInstance`, laid over the definition as `MountOptions.instance`), `icons` and `mode`: `standalone`, `persisted` or `full`), `write` (`writes`: `{ path, value }` or `{ path, remove: true }` below `$.data`, `$.app`, `$.screens`, `$.theme`, `$.locale` or the sync status `$.runtime.sync`, and optional `icons`; a whole node below `$.app` or `$.screens.{name}` is mounted, and a write of the protected `$.route` is refused), `event` (`name` from `APP_EVENTS`, `payload?`), `command` (`target`, `command`, `value?`), `locale` (`locale`), `theme` (`kind`, `name`) `ping` (`id`), `fileProgress` and `fileResult` (see Files below). Runtime to host: `ready`, `change` (`change`: `{ id, path, op, value? }`, `op` one of `CHANGE_OPS`), `emit` (`name`, `payload?`), `error` (`errors`: `{ code, message, severity?, statePath?, component? }`) `pong` (`id`), `file` and `fileCancel`.

**`validateMessage(value)`** returns `{ ok: true, message }` or `{ ok: false, reason }`. The reason is `invalid` (not an object of the protocol, wrong version, no nonce, a wrong or extra field, a write or change outside the paths above or through `__proto__`, a change to `$.runtime`, an `event` that is not an app event), `unknown` (a type outside the set) or `oversized` (over `MESSAGE_BYTE_LIMITS` for its type, or not serialisable). It does not compare the nonce. Limits (`limits.ts`): load 3 MiB, write and change 512 KiB, event, emit, error and command 64 KiB, the small types 1 KiB; 500 writes per message; 50 errors per error message. The `icons` map (`isIconsMap`) has at most 256 icons named in lower-case words, each `{ outline, filled? }` with at most 32 paths of at most 8 KiB, only SVG path data characters, and at most 256 KiB in all.

**`startRuntime(window, parent, nonce, library, { host?, componentOverlays?, route? })`** listens for `message` events and acts only when `event.source === parent` (pass `window.parent`), the message validates and carries the nonce. Everything else is dropped and counted in `handle.stats().dropped` (`invalid`, `unknown`, `oversized`, `unhandled`, `foreign`). `host` defaults to `window.document.body`. `route` (false by default) is `MountOptions.route` for the apps it mounts: the runtime runs in a frame, where a history entry would also move the host page's back button, and the frame's fragment holds the nonce.
- `load` calls `mountApp` in the message's `mode` (default `standalone`; a running app is disposed first), which sets `$.runtime.sync` to `{ mode, status, waiting: 0 }` (status `standalone`, or `connecting` until the host writes it). The `state` is applied (its `data` replaces `$.data` whole, as it is a copy of it; its `app` articulation is laid over the document) and `icons` written to `$.runtime.icons` before the first render; articulation values for nodes that no longer exist and for runtime properties are skipped, and a declared property the document leaves unset (the `items` and `total` logic fills into a list) is set. Then it posts `ready`. A document that does not mount posts `error` with the errors and no `ready`.
- `write` sets or removes the paths and merges `icons`. A value that is a whole node (an object with a `component`) below `$.app` is mounted as a load would mount it (`MountedApp.writeNode`): component defaults and composed components resolved, its `<-` links applied with `^name` references resolved against the whole app, and the links of the node it replaces removed; removing a node removes its links (`removeNode`). To swap a component or change a link, write the node whole: a `component` or `<-` key written on its own is a plain store write. Writes are sync writes (`SYNC_ORIGIN` of `@punyts/state-sync`): they post no `change`. A write the store refuses posts `SUI-RUN-WRITE`. The host's sync client writes the server's changes and the sync status this way.
- `event` raises an app event (`sync.rejected`, from the sync client's `onRejected`) with `MountedApp.raise`: the root node's `on` entry for it runs with the payload as `context.payload`, so `{ command: 'emit', target: 'rejected' }` passes `{ path, reason }` on. `validateOn` accepts the app events on the root node only.
- `ping` is answered with `pong`.
- `command` (`target`, `command`, `value?`) runs a component command with the command runner the dispatcher uses for `on`. `target` is the state path of a node (`$.app…`, or `$.screens.{name}…` for a node of a screen); its component must declare `command` and its element must handle it (`element.commands`). An unknown target posts `SUI-RUN-ON-TARGET`, an undeclared or unhandled command `SUI-RUN-ON-COMMAND`, and nothing changes. `navigate` takes a screen name as `target` and the params as `value` and runs `MountedApp.navigate`; a refusal posts `SUI-RUN-ON-COMMAND` with the reason. The system commands `set`, `toggle` and `emit` are refused with `SUI-RUN-ON-COMMAND`: a write goes through `write`, and `emit` would send the minion's own event back to it. `$.route` and `$.screens` are not synced branches yet: their changes are posted but the host drops them, and `write` cannot reach them.
- `locale` (`locale`) applies the language overlay with `switchLocale`: the text content of `$.app` and of every screen changes and `$.data` does not. The overlays come from the document's `locales` and from `startRuntime`'s `componentOverlays` option (the library's `<name>.locale.<code>.json` files, as `ComponentOverlays`); a library overlay replaces only content that still holds the component's default. A language with no overlay posts `SUI-LOCALE-UNKNOWN`. The base language of the document is also a valid code.
- `theme` (`kind`, `name`) applies the overlay `name` of `kind` (`mode`, `brand` or `motion`) with `applyOverlay`: the shipped overlays and the document's `themes`. An unknown kind or name posts `SUI-THEME-OVERLAY`. Going back is applying the other overlay of the kind (`light`).
- `command`, `locale`, `theme`, `write` and `event` need a mounted application; before `load` they are counted as `unhandled`. A `load` mounts again from the document, so the host sends `locale` and `theme` again after it.
- `change` is posted for every change of the store that is not a sync write: the user's typing, a controller, an `on` command (`captureChanges` of `@punyts/state-sync`, batched to a microtask and folded). Each carries an id and no base; the host's sync client gives it the base and queues it. `$.runtime`, `$.server`, link aliases and the runtime properties of a node (`runtime: true`, which its component computes on every mount) make no change, and neither the `load` state nor a `write` sets a runtime property. The `value` of an `inputType: "password"` node and the `$.data` path such a node's `<-value` is linked to are never posted: such a change is dropped, and it is cut out of the value of a change above it.
- `emit` comes from the dispatcher's `onEmit` hook; `error` from `onError`, mount errors, uncaught errors and unhandled rejections (`SUI-RUN-BINDING`). At most 200 errors are posted per runtime.
- Files (E8.39, ADR-0017): the runtime gives `mountApp` the hook `transferFile(file, { onProgress?, signal? }): Promise<FileReference>`, which a component reaches as `hooks.transferFile`. It posts `file` (`{ requestId, name, size, mediaType, data }`; `requestId` is a positive integer; `data` is an `ArrayBuffer` of `size` bytes in the transfer list, so the sender's buffer is detached; the media type is `mediaType` because `type` is the message type). The host answers `fileProgress` (`{ requestId, loaded, total }`, passed to `onProgress({ loaded, total })`) and then `fileResult` (`{ requestId, ok: true, file: { id, name, size, type } }` or `{ requestId, ok: false, code, message }`, `code` one of `FILE_ERROR_CODES`: `too_large`, `unsupported_type`, `quota`, `not_found`, `unauthorized`, `offline`, `cancelled`, `internal`). The promise resolves with the reference or rejects with a `FileTransferError` whose `code` is that code. Aborting `signal` posts `fileCancel` (`{ requestId }`) and rejects with `cancelled`; with no `fileProgress` or `fileResult` for `FILE_IDLE_TIMEOUT_MS` (120 s, counted from the last progress or the `file` message) it rejects with `offline`. A file over `MAX_FILE_BYTES` (10 MiB) rejects with `too_large` without posting. A `fileResult` or `fileProgress` for a request that is not waiting is ignored. A new `load` or `dispose` cancels waiting transfers. Validation: `data` must be an `ArrayBuffer` (of any realm) whose `byteLength` equals `size` and is at most `MAX_FILE_BYTES` (over it is `oversized`, a mismatch `invalid`); the JSON fields of the four types are limited to `MAX_FILE_JSON_BYTES` (2 KiB). `FileReference` (`{ id, name, size, type }`) is exported; no bytes are written to the store and snapshots never hold a buffer.
- File transfer event (E8.22): a component controller has no access to the hooks, so it raises `FILE_TRANSFER_EVENT` (`ui-file-transfer`, bubbles and composed) with a `FileTransferRequest` detail `{ file, onProgress?, signal?, respond(promise) }`. The dispatcher stops the event and calls `respond` once, synchronously, with `hooks.transferFile(file, { onProgress, signal })`. With no `transferFile` hook `respond` is not called; the component treats that as a transfer that cannot be made.
- Posting uses target origin `*`, because a frame sandboxed without `allow-same-origin` has an opaque origin; the nonce is the check.

### Runtime bundle

`runtime-bundle/` builds the one script the preview page loads (E7.2); it is not part of `dist/` output of `tsc` and not exported as code.
- `entry.ts` bundles StateUI, this package, `@punyts/stateui-components` (registered with `register(window)`, its `catalog.json` turned into the library with `libraryFromCatalog`) and every component locale overlay (`<name>.locale.<code>.json`, through the virtual module `virtual:component-overlays`, passed as `componentOverlays`). It reads the per-load nonce from the URL fragment (`page.html#<nonce>`, 16 to 128 of `A-Za-z0-9_-`) and calls `startRuntime(window, window.parent, nonce, library, { componentOverlays })`. Without a well-formed nonce nothing starts.
- `npm run build:runtime-bundle` type-checks the folder, bundles with esbuild (one minified classic script, `iife`, ES2022) and writes `dist/runtime-bundle/<hash>.js` and `manifest.json` (`{ hash, script }`), removing the files of earlier builds. `<hash>` is the first 16 hex digits of the SHA-256 of the script, so the name changes when the source does. The package export `@punyts/stateui-app/runtime-bundle/*` maps to that folder; the ai-minion API reads the manifest through it. It needs `@punyts/stateui-components` built, so it is not part of `npm run build`: the API build runs it.
- `buildRuntimeBundle({ entry, outDir })` (`build.ts`) is the function behind the script.

## Search

Code is in `src/core/search/`, exported from `@punyts/stateui-app/core`. It imports nothing outside that folder (no catalog types, no DOM), so every catalog that ranks entries by a need in plain words uses the same engine: `ui_components_search` in `@punyts/stateui-mcp` and AI Minion's `ui-builder`.

- **`tokenize(text)`** splits camelCase and every run of non-letters, lowercases, drops a short list of stop words (`STOP_WORDS`: a, the, of, to, ...) and stems each word (`dateRangeField` gives `date`, `range`, `field`). `words(text)` is the same without stop words or stems.
- **`stem(word)`** is a light stemmer, the same for documents and needs. The first rule whose suffix the word has decides: `ies` becomes `y`; otherwise `ing`, `ed`, `es` (only after `s`, `x`, `z`, `ch` or `sh`) or `s` (not after `ss`) is removed; nothing is removed when fewer than three letters would remain. So `dates`, `boxes`, `entries` and `selecting` meet `date`, `box`, `entry` and `select`, while `class` and `need` stay. It is deliberately simple: `dated` gives `dat`, not `date`.
- **`SYNONYM_GROUPS`** is the reviewed table (pick/choose/select, sum/total, show/display, remove/delete, change/edit/update, login/sign/signin, money/price/cost, picture/photo/image). A need word is expanded to its group, and a member found in an entry counts as a match of the need word. `synonymExpander(groups)` builds the expansion of another table.
- **`createSearchIndex(entries, { synonyms? })`** builds the index once from `{ id, fields }`, where `fields` has four lists of strings: `purposes` (weight 3), `name` (2), `summary` (1) and `properties` (property and event names, 0.5). `search(need, limit?)` ranks with BM25 over the weighted fields (k1 1.2, b 0.75: per term the field frequencies are length-normalised per field, weighted and summed, then saturated once and multiplied by the idf over whole entries). A need word scores through the best of its synonyms, never through two. Ties go to the entry that matched more distinct need words, then to the lower id. Each hit is `{ id, score, matched }`: `matched` lists the purpose phrases, verbatim, that hold a matched word, then the need words matched only in other fields. An empty need, a need of stop words only and a need with no match return `[]`; what to show then is the caller's choice.

## Path geometry

Code is in `src/core/geometry/`, exported from `@punyts/stateui-app/core`. It touches no DOM, so the SVG and canvas renderers, hit testing and the `pathData` validator share it. Path data is only ever parsed, never inserted as markup.

- **`parsePathData(text)`** gives `{ ok: true, commands }` or `{ ok: false, index }`, the index of the first bad character. It takes `M L H V C S Q T A Z` in both cases; each `PathCommand` keeps its `type` (upper case), `relative` (true for a lower-case letter) and named arguments (`x1`, `y1`, `x2`, `y2`, `x`, `y`; an arc has `rx`, `ry`, `rotation`, `largeArc`, `sweep`). Implicit repeats give one command each, a repeated moveto a lineto of the same case. Arc flags are one `0` or `1` and need no separator (`a1 1 0 00.5.5`), and numbers may run together (`1-2`, `.5.5`). It refuses a stray character, an unknown letter (`NaN` included), a missing argument or arc flag, a number that is not finite (`1e999`, at its first character), a comma with no number after it, arguments after `Z` and data that does not start with a moveto. Empty or blank data is no commands.
- **`flattenPath(commands, tolerance)`** gives one `FlatSubpath` (`{ points, closed }`, points as `[x, y]`) per subpath, in absolute coordinates, with `S` and `T` reflected as SVG does. Lines are kept; quadratic and cubic curves and arcs are cut so that the outline is within `tolerance` of the polyline, in at most `MAX_FLATTEN_SEGMENTS` (1024) segments each. An arc with a zero radius is a line, radii too small for the end point are scaled up, and an arc to its own start point draws nothing. A tolerance that is not a positive finite number is a `RangeError`.
- **`pathBounds(commands)`** gives the exact axis-aligned bounds `{ x, y, width, height }` (curve extrema and the extreme points of each arc, not the control points; moveto points count), or undefined for no commands.

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
| `catalog.json` | Every component that built, root, composed and shape, sorted by name (and the patterns of `patternsDir` and theme presets of `presetsDir`, see below): `name`, `tier`, `tag`, `size`, `summary`, `category`, `purposes`, `shape`, `content`, `slots`, `events`, `commands`, `layout`, `locales`, `example` (composed entries have `tree` instead of the shape fields; shape entries have no `tag`, `shared`, `slots`, `commands` or `layout`, and carry `own` and `tokens`) |
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
  and `node` properties (`map.field` inside map items), and `example` is the component with its required properties and the ones a `requiredWhen` makes required.
  An entry also carries `shared`, `tokens`, `placement` and `exposes` when the shape declares them. A composed entry has `tree` (the default tree, never an `exposes` key) and `exposes`: a list of `{ path, description }` in file order, absent when the file lists none. `category` and `purposes` sit at the top of an entry (not in its `shape`) when the file declares them; a composed file declares `summary`, `category` and `purposes` as top-level keys beside `exposes`, which `parseComposed` checks with the shape rules and strips from the tree. `catalog.json` also
  has a top-level `locales`: every language a built component has an overlay for, sorted. The same result is
  `BuildResult.catalog`.
- **Theme section.** `catalog.json` has a top-level `theme`, built by `buildThemeSection` from the default token tree (`flattenTokens`), the one-line descriptions in `src/core/theme/tokens.descriptions.json` and the shipped overlays. `theme.tokens` lists every semantic token as `{ path, type, default, group, description }` in tree order (`default` is the `light` and `default` value, references kept as `{path}`); the primitive tokens (`palette`, `scale`, `font`) are left out, because a node override may set only semantic and component tokens, and component tokens stay on their component entry. `theme.overlays` lists the shipped overlays by kind (`mode`, `brand`, `motion`) as `{ name, groups }`, where `groups` are the token groups the kind may touch. A semantic token without a one-line description is `SUI-BUILD-TOKENDESC` and fails the build; the `tokenDescriptions` build option replaces the descriptions.
- **Locale overlays.** Each `<name>.locale.<code>.json` is checked while building. A root overlay may name only `_`
  content properties of its shape (and `_` properties inside map items); anything else is `SUI-LOCALE-CONTENT` or
  `SUI-LOCALE-PATH`. A composed overlay is checked against its resolved default tree. An error names the file; the
  component with the error gets no module or catalog entry, and a file that is not valid JSON or not an object is
  `SUI-BUILD-SHAPE`.
- **Extension points.** `cssTransforms` (CSS text to CSS text, run in order before StateUI compiles the CSS) and
  `cssChecks` (return `SUI-BUILD` errors; they see the CSS as written, so their lines match the file). With none
  registered the output is the same as without the points.
- **Search keys (`requireSearchKeys`).** Off by default: a component without `category` or `purposes` (and a composed file without `summary`) builds and its entry leaves the keys out. With `{ requireSearchKeys: true }` each missing key is an error (`SUI-BUILD-CATEGORY`, `SUI-BUILD-PURPOSES`, `SUI-BUILD-SUMMARY`) and the component gets no entry. In both modes a present value that breaks its rule is an error, and a purpose phrase that repeats another component's, compared lowercased, trimmed and with inner spaces collapsed (`normalizePurpose`), is `SUI-BUILD-PURPOSE-DUPLICATE` on the later component in name order, naming the earlier one.
- **Patterns (`patternsDir`).** A folder of `<kind>/<name>/<name>.pattern.json`, where the kind is `shell` or `screen` and the name is lower-case hyphenated (see Patterns). After the components are built, each file is read with `readPattern`, checked with `checkPattern` against the components that built, and the purposes with `checkPatternPurposes` across the patterns. A file in the wrong place (wrong depth, an unknown kind folder, a folder name that is not lower-case hyphenated, a file not named after its folder) or not valid JSON is `SUI-PATTERN-FILE`; files are named relative to `patternsDir`. A pattern with any problem fails the build and is left out; for a repeated purpose, the later pattern in name order. `catalog.json` has a top-level `patterns`: `{ name, kind, summary, purposes, tree, slots, params, components }` sorted by kind then name, where `components` lists the component names the tree uses, sorted (a composed node is not opened). Without the option `patterns` is `[]`. `buildPatterns(patternsDir, library)` is exported for a build of patterns alone.
- **Theme presets (`presetsDir`).** A folder of `<name>.preset.json`, the name lower-case hyphenated, each a theme part with a one-line `summary`: `{ summary, tokens, overlays? }`, `overlays` by name as `{ kind, tokens }`. `readPreset` checks the shape (`SUI-PRESET-SHAPE` with its path), the base tokens with `validateTokens` (with the library's component tokens) and each overlay with `validateThemeOverlay`; the overlay contrast warnings are not build errors, since a theme's contrast is reported where it is written. A file with another name, in a sub-folder or not valid JSON is `SUI-PRESET-FILE`. A preset with any problem fails the build and is left out. `catalog.json` has a top-level `themePresets`: `{ name, summary, tokens, overlays }` sorted by name; without the option it is `[]`. `buildPresets(presetsDir, componentTokens?)` is exported.
- **Shared stylesheets (`sharedCssDir`).** With `buildLibrary(src, out, { sharedCssDir: 'src/shared/css' })`, a line that holds only `@include "<name>.css";` in a component's `view.css` is replaced with the text of `<name>.css` from that folder, before the `cssChecks`, the built-in checks and the transforms run. The token lint therefore checks the partial as part of every component that includes it, and the token fallbacks apply to it. The name must be a plain file name (`^[a-z0-9][a-z0-9-]*\.css$`); an unknown file, a name with a path, and an `@include` inside a partial are `SUI-BUILD-IO` errors at the include line and column, and the component gets no module. Lines reported after an include count the inlined text. Without the option no line is touched.
- **Shared shape partials (`sharedShapeDir`, `includes`).** With `buildLibrary(src, out, { sharedShapeDir: 'src/shared/shape' })`, a state file (of a root or a shape-tier component) may list `"includes": ["paint", "transform"]`: each name is a file `<name>.json` directly in that folder, an object of only `properties`, `events` and `tokens`, merged under the file's own before the shape is read (`parseShape(text, file, { partials })`, `applyShapeIncludes`). The merged shape lists the own properties and tokens first, in file order, then each included one the file does not declare, in the order of `includes`; the events are the own ones followed by each included event not already listed. An own property or token wins over an included one, and the included properties are checked as if written in the file, so the catalog entry (and `ui_component_get`) shows the merged result and equals the one of the file written out in full. `SUI-BUILD-SHAPE` on the state file: `includes` that is not a list of unique names (`^[a-z0-9][a-z0-9-]*$`, no `.json`), an unknown partial, a partial that is not valid JSON or holds another key (so a partial cannot include another), and a property or token two partials both declare. Without the option every included name is unknown. `shared` stays the closed list of articulation names; `includes` is how a property group is shared.
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
- **Contrast.** `checkContrast(effectiveTree)` resolves `color.<tone>.base` with `color.<tone>.on` for every tone, and `color.text.base` with `color.surface.base`, through references to opaque literal colours. A pair below 4.5:1 is a `SUI-THEME-CONTRAST` warning naming both state paths; a pair that does not resolve to opaque literals is skipped. Every `color.data.*` colour (E8.10) is checked against `color.surface.base` in the same way at `MIN_DATA_CONTRAST` (3:1). `contrastRatio(a, b)` is the WCAG ratio of two opaque colour literals.

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
- **`themes`.** `"themes": { "acme": { "kind": "brand", "tokens": { } } }` adds overlays after the same validation. A `mode` overlay
  named `light`, `dark` or `contrast` refines that shipped mode: its tokens are merged over the shipped ones (and checked
  merged), and the result takes the shipped one's place, so `system` picks the theme's own light and dark. Any other name
  that is already a shipped overlay of the same kind (or `system` for `mode` and `motion`) is `SUI-THEME-OVERLAY`. The `theme` document
  validator (`validateTheme`) also checks that every name in `theme.active` is an overlay of its kind or `system`.
- **At start.** `mountApp` composes the active overlay of each kind over the default tree and puts the document's `theme.tokens` last,
  so the document's own values win at start. While mounted, a change to `$.theme.active.<kind>` (`store.set`, not only
  `applyOverlay`) applies that overlay. An unknown name is reported through `hooks.onError` and changes nothing. Applying an overlay
  replaces document token values in its groups.
- **`system`.** `$.theme.active.mode: "system"` applies `light` or `dark` from `prefers-color-scheme` at start and when the query
  changes; `motion: "system"` applies `reduced` or `full` from `prefers-reduced-motion`. `$.theme.active.<kind>` stays `system`.
  Setting an explicit name stops following; setting `system` again resumes. The system never selects `contrast`.
- **Several themes** (`core/theme/appThemes.ts`). An assembled app carries `appThemes`: every theme of `uses.themes` by
  name, each `{ tokens, overlays? }`; `theme` and `themes` stay the first's, so a one-theme document mounts as before.
  `$.theme.active.theme` names the active one (the instance's, then the document's `theme.active.theme`, then the first:
  `startTheme`), whose tokens and overlays are used at start. Setting it (`set` in `on` or logic, `ui_state_set`)
  rebuilds `$.theme.tokens` from the new theme with no reload. The overlay names carry over when the new theme has them
  (`system` too); otherwise they fall back to its own first overlay of the kind, then `system` for `mode` and
  `motion`, then the shipped `default` brand (`activeAfterSwitch`). A name the app does not list is
  `SUI-STATE-INVALID` (through `hooks.onError`, naming the app's themes) and the store is set back. The document
  validator checks each entry of `appThemes` at `$.appThemes.{name}` and `theme.active.theme` against the list. The
  persona's choice is part of the instance (`MountOptions.instance.theme.active.theme`); a name no longer listed falls
  back to the first theme with `SUI-INSTANCE-STALE`. The preview runtime's `theme` message still applies overlays of
  the first theme.
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
npm run build:runtime-bundle   # needs @punyts/stateui-components built
```

## License
MIT
