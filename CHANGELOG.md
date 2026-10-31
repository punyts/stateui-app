# Changelog

## 0.1.0
- Scaffold: package, build and test setup, and the `.` and `./core` entry points (AMM-1649).
- Build option `sharedCssDir`: a line `@include "<name>.css";` in a `view.css` is replaced with that file of the shared folder before the checks and transforms, so the token lint covers the partial. An unknown or non-plain file name, and an `@include` inside a partial, are `SUI-BUILD-IO` with the line.
