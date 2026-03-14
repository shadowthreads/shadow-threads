# Error Codes v1

Frozen error code registry for Artifact Protocol v1.

- `ERR_PAYLOAD_TOO_LARGE`
- `ERR_PAYLOAD_UNSAFE_KEY`
- `ERR_PAYLOAD_CONTAINS_NULL_CHAR`
- `ERR_PAYLOAD_STRUCTURE_LIMIT`
- `ERR_ARTIFACT_HASH_COLLISION_OR_IMPL_BUG`

## Usage notes
- Error code strings are fixed literals.
- Do not interpolate IDs/hashes/paths into code strings.
- Human-readable messages may be mapped externally, but protocol codes are stable.
