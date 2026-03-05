# Artifact Bundle v1

ArtifactBundle is the portable protocol object for frozen v1.

## Shape
```json
{
  "schema": "string",
  "identity": {
    "packageId": "string",
    "revisionId": "string (optional)",
    "revisionHash": "string (optional)"
  },
  "payload": {},
  "references": [
    {
      "bundleHash": "string",
      "role": "string"
    }
  ]
}
```

## bundleHash derivation
- `bundleHash = SHA256(canonicalJSON(sanitizedBundle))`
- Output format:
  - lowercase hex
  - length 64

## Deterministic requirements
- Canonicalization follows `shadow-canonical-json.v1.md`.
- No locale-dependent behavior.
- No time/random inputs.

## Notes
- `references` is optional.
- Missing optional fields are normalized to `null` or omitted per canonicalization rules of the producer.
