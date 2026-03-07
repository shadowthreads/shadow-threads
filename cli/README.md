# Shadow Threads CLI

Shadow Threads CLI is a small HTTP client for the Shadow Threads server runtime.

## Commands

```bash
shadow init
shadow capture <file>
shadow inspect revision <id>
shadow inspect artifact <hash> --package <packageId>
shadow inspect execution <id>
shadow replay <execution-id>
shadow migrate export <revision-id>
```

## Configuration

Run `shadow init` in your working directory to create:

- `.shadow/`
- `shadow.config.json`

Default config:

```json
{
  "server": "http://localhost:3000",
  "workspace": ".shadow"
}
```

## Capture Input

`shadow capture <file>` expects a full artifact bundle request body for `POST /api/v1/artifacts`.

Example:

```json
{
  "schema": "artifact.task.state.v1",
  "identity": {
    "packageId": "package-123",
    "revisionId": null,
    "revisionHash": null
  },
  "payload": {
    "name": "example"
  },
  "references": []
}
```

## Notes

- `shadow inspect artifact` requires `--package` because the current server API resolves artifacts by `packageId + bundleHash`.
- `shadow replay <execution-id>` first loads the execution record, then reconstructs the replay body required by the server.
- `shadow migrate export <revision-id>` copies the returned server zip path to `migration.zip`. This assumes the CLI can access the same filesystem as the server.
