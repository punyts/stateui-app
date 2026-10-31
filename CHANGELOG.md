# Changelog

## 0.1.0
- Scaffold: package, build and test setup, and the `.` and `./core` entry points (AMM-1649).
- Build option `sharedCssDir`: a line `@include "<name>.css";` in a `view.css` is replaced with that file of the shared folder before the checks and transforms, so the token lint covers the partial. An unknown or non-plain file name, and an `@include` inside a partial, are `SUI-BUILD-IO` with the line.
- Fix: `buildAppOverlay` with the `library` option now translates the entries of a content map (`_errors.required`); before, only entries whose key started with `_` were picked.
- Validator `regex` (a maximum length, 1 to `MAX_PATTERN_LENGTH`): a string property whose value must be a regular expression of at most that length that compiles and has no nested quantifier such as `(a+)+`; for a field's `pattern`.
