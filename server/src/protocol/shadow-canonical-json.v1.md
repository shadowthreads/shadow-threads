# Shadow Canonical JSON v1

This spec defines deterministic canonicalization for Artifact Protocol v1 hashing.

## Encoding
- UTF-8

## String normalization
- Apply NFC normalization to all string values.
- Do not normalize object keys.

## Key ordering
- Sort object keys by Unicode codepoint ascending using:
  - `(a < b ? -1 : a > b ? 1 : 0)`
- `localeCompare` is not allowed.

## undefined handling
- Object property with `undefined` is removed.
- Array `undefined` entries are removed and array is compacted.

## Number rules
- `NaN` and `Infinity` are rejected.
- `-0` is normalized to `0`.

## Null character rule
- If a string contains `\u0000`, reject with `ERR_PAYLOAD_CONTAINS_NULL_CHAR`.

## Unsafe key rule
- Reject object keys: `__proto__`, `constructor`, `prototype`.
- Error code: `ERR_PAYLOAD_UNSAFE_KEY`.

## Structure limits
- `maxDepth = 64`
- `maxNodes = 100000`
- Exceeding either limit rejects with `ERR_PAYLOAD_STRUCTURE_LIMIT`.

## Payload size limit
- Maximum canonical payload size is 1MB (UTF-8 byte size).
- Exceeding limit rejects with `ERR_PAYLOAD_TOO_LARGE`.
