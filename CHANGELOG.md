# Changelog

## 0.1.0
- Scaffold: package, build and test setup, and the `.` and `./core` entry points (AMM-1649).
- Build option `sharedCssDir`: a line `@include "<name>.css";` in a `view.css` is replaced with that file of the shared folder before the checks and transforms, so the token lint covers the partial. An unknown or non-plain file name, and an `@include` inside a partial, are `SUI-BUILD-IO` with the line.
- Fix: the catalog `example` of a component now includes each property a `requiredWhen` makes required (with its default or a sample value), so the example passes `validateNode`; before, it left them out.
- Fix: `buildAppOverlay` with the `library` option now translates the entries of a content map (`_errors.required`); before, only entries whose key started with `_` were picked.
- Validator `regex` (a maximum length, 1 to `MAX_PATTERN_LENGTH`): a string property whose value must be a regular expression of at most that length that compiles and has no nested quantifier such as `(a+)+`; for a field's `pattern`.
- `mountApp` no longer applies a `$row` link found in a row template (a `row: true` slot or map-item field): the `<-key` stays in the tree as written, so a component can pass the template to `resolveRowLinks`; before, such a document failed to mount with `SUI-LINK-MISSING`.
- Fix: `libraryFromCatalog` carries a catalog entry's declared `placement` into its library shape, so children of a component with a placement shape (tabs) validate.
- Shape key `commandValues` and the error `SUI-ON-VALUE`: a literal `value` of a listed command must be a key of the named `map` property.
