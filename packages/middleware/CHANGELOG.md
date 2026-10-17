# @adaptivemcp/middleware

## 0.1.4

### Patch Changes

- Updated dependencies [301af23]
  - @adaptivemcp/spec@0.6.0

## 0.1.3

### Patch Changes

- 580d8c2: Internal dependencies now use caret ranges (`workspace:^`) instead of exact pins.

  pnpm rewrote `workspace:*` to an exact version on publish, so a consumer mixing
  `@adaptivemcp/*` packages from different releases could end up with two copies of
  the same package (duplicate state, `instanceof` mismatches, no dedupe). The
  ranges are now compatible (`^x.y.z`), so a resolver picks one copy.

- Updated dependencies [e897d0e]
  - @adaptivemcp/spec@0.5.0

## 0.1.2

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [9df0b31]
  - @adaptivemcp/spec@0.3.0
