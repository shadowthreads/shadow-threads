# Shadow Threads Reference

## RevisionMetadata

`RevisionMetadata` requires these fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `author` | yes | Human-readable author label for the revision |
| `message` | yes | Short description of why the revision exists |
| `created_by` / `createdBy` | yes | Concrete actor or tool that created the revision |
| `timestamp` | yes | ISO 8601 timestamp with timezone offset |
| `source` | yes | One of `human`, `ai`, `migration`, `system` |
| `tags` | optional | List of short labels; defaults to `[]` |

In the Python SDK, the dataclass field is `created_by`. The SDK serializes it to the API field `createdBy`.

## prompt_hash

`prompt_hash` is the deterministic identity of the prompt boundary used for an execution. Expected format:

- 64 lowercase hexadecimal characters
- often `sha256(prompt_bytes).hexdigest()`

Purpose:

- binds the execution record to the exact prompt boundary that was used
- allows replay to reject non-deterministic changes before comparing outputs
- prevents silent drift between recorded execution inputs and later verification

The system does not enforce how the hash is generated. It only requires that the same prompt produces the same hash.

## Timestamp format

`timestamp`, `started_at`, and `finished_at` must be ISO 8601 strings with an explicit timezone offset.

Accepted examples:

```text
2026-03-12T09:00:00+00:00
2026-03-12T09:00:00Z
```

Do not omit the timezone.
