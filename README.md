# Shadow Threads

Shadow Threads records and verifies AI workflow state.

It lets developers persist workflow artifacts, track state revisions,
record model or tool executions, and replay those executions
deterministically.

## The problem

AI workflows are difficult to reproduce because outputs depend on more than a final prompt. They also depend on parameters, intermediate state, tool calls, and the exact artifacts passed between steps. Once that context drifts, debugging and verification become unreliable. Shadow Threads addresses this by recording workflow state and execution boundaries as deterministic artifacts and revisions. That gives developers a stable way to inspect, transfer, and replay workflow state without relying on implicit runtime context.

## 30-second overview

Shadow Threads gives you four durable objects:

- **Artifact** - a content-addressed bundle for task state or any other workflow payload.
- **Revision** - a package-local DAG node that binds artifacts into a verifiable state snapshot.
- **Execution** - a recorded model or tool boundary with fixed inputs, outputs, status, and result hash.
- **Replay** - a verification step that checks whether a stored execution boundary still matches exactly.

The local server exposes these objects through `/api/v1`. The Python SDK, CLI, demos, and MCP server all use that same boundary.

## Install instructions

### Prerequisites

- Node.js 20+ recommended (`server/package.json` requires `>=18`)
- Python 3.10+
- Docker

### Start local infrastructure

From the repository root:

```bash
docker compose up -d postgres redis
```

### Install and prepare the server

```bash
cd server
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run build
```

### Install the Python SDK

From the repository root:

```bash
pip install -e python-sdk
```

## Run server instructions

Start the API server in a separate terminal:

```bash
cd server
npm run start
```

Default local address:

```text
http://localhost:3001
```

The Python SDK also respects `SHADOW_SERVER` if you want to point to a different base URL.

## Ultra minimal Python example

The example below records a minimal workflow state, creates a revision, records one execution, and verifies it.

```python
from hashlib import sha256
from shadowthreads import ArtifactReference, RevisionMetadata, ShadowClient

package_id = "readme-first-run"
prompt_hash = sha256(b"Summarize the current workflow state.").hexdigest()
started_at = "2026-03-12T09:00:00+00:00"
finished_at = "2026-03-12T09:00:01+00:00"

with ShadowClient(base_url="http://localhost:3001") as client:
    artifact = client.capture_artifact(
        schema="artifact.task.state.v1",
        package_id=package_id,
        payload={"task": "example", "state": "ready"},
    )

    ref = ArtifactReference(bundle_hash=artifact.bundle_hash, role="primary_state")

    revision = client.create_revision(
        package_id=package_id,
        artifacts=[ref],
        metadata=RevisionMetadata(
            author="README example",
            message="Initial task state",
            created_by="python-sdk",
            timestamp=started_at,
            source="human",
        ),
    )

    execution = client.record_execution(
        package_id=package_id,
        revision_hash=revision.revision_hash,
        provider="local-example",
        model="shadow-demo-model",
        prompt_hash=prompt_hash,
        parameters={"temperature": 0},
        input_artifacts=[ref],
        output_artifacts=[ref],
        status="success",
        started_at=started_at,
        finished_at=finished_at,
    )

    replay = client.replay_execution(execution.execution_id)
    print(replay.verified)
```

## First successful run

This is the shortest reliable path for a fresh checkout.

1. Start Postgres and Redis:

   ```bash
   docker compose up -d postgres redis
   ```

2. Build and prepare the server:

   ```bash
   cd server
   npm ci
   npm run prisma:generate
   npm run prisma:migrate
   npm run build
   npm run start
   ```

3. In another terminal, install the SDK:

   ```bash
   pip install -e python-sdk
   ```

4. Save the example above as `first_run.py` and run:

   ```bash
   python first_run.py
   ```

A successful run prints `True` from `replay.verified`. If you expand the example to print IDs and hashes, you should see:

- a 64-character `artifact_bundle_hash`
- a 64-character `revision_hash`
- a UUID `execution_id`
- a 64-character `result_hash`

That confirms a full record plus replay cycle against the local API.

## Core concepts

### Artifact

An artifact is the smallest durable unit in Shadow Threads. It stores:

- `schema`
- `identity` (`packageId`, optional `revisionId`, optional `revisionHash`)
- `payload`
- optional `references`

Artifacts are content-addressed. The server derives `bundleHash` from canonicalized content.

### Revision

A revision binds one or more artifacts into a package-local DAG node. A revision answers: what state did this package have at this point in time? Revisions are hashed deterministically and can only inherit from parents in the same package.

### Execution

An execution records a model or tool boundary for a specific revision. It stores:

- `provider`
- `model`
- `promptHash`
- `parameters`
- `inputArtifacts`
- `outputArtifacts`
- `status`
- `resultHash`

This makes the execution boundary inspectable and replayable.

### Replay

Replay verifies an existing execution record. It checks that:

- `promptHash` still matches
- `parameters` still match
- `inputArtifacts` still match
- recomputed `resultHash` still matches the recorded execution

Replay is verification, not a best-effort rerun.

## Capabilities enabled by Shadow Threads

### Deterministic workflow replay

Execution records allow deterministic replay because replay uses the recorded execution boundary instead of reconstructing it from memory. That boundary includes `promptHash`, `parameters`, `inputArtifacts`, `outputArtifacts`, and `resultHash`. Replay verifies that the same execution inputs still produce the same recorded result boundary. This makes mismatches explicit and auditable rather than implicit runtime drift.

### Workflow state portability

Revisions represent snapshots of workflow state, and artifacts contain the payload that produced that state. Because artifacts are content-addressed and revisions form a deterministic DAG, workflow state can be exported and reconstructed elsewhere without redefining identity. This supports continuing reasoning with another model, moving workflow state between environments, and resuming work from a saved snapshot. The portable unit is the recorded artifact and revision graph, not hidden local process memory.

### Agent execution audit

Execution records provide an audit trail for agent workflows. Developers can inspect prompt hashes, parameters, and artifact boundaries to understand how an agent arrived at a state. This is useful for debugging complex agent workflows, tracing tool calls, and auditing reasoning chains across multi-step runs. The audit surface stays tied to recorded boundaries rather than informal logs or recollection.

## Metadata reference

### RevisionMetadata

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

### prompt_hash

`prompt_hash` is the deterministic identity of the prompt boundary used for an execution. Expected format:

- 64 lowercase hexadecimal characters
- often `sha256(prompt_bytes).hexdigest()`

Purpose:

- binds the execution record to the exact prompt boundary that was used
- allows replay to reject non-deterministic changes before comparing outputs
- prevents silent drift between recorded execution inputs and later verification

The system does not enforce how the hash is generated. It only requires that the same prompt produces the same hash.

### Timestamp format

`timestamp`, `started_at`, and `finished_at` must be ISO 8601 strings with an explicit timezone offset.

Accepted examples:

```text
2026-03-12T09:00:00+00:00
2026-03-12T09:00:00Z
```

Do not omit the timezone.

## When should you use Shadow Threads?

Use Shadow Threads when you need:

- reproducible AI workflows
- auditability of model and tool executions
- debugging for complex agent workflows
- deterministic replay of recorded task state
- migration of verifiable workflow history between environments
- portability of workflow state across models or environments

## Demo references

Two repository demos exercise the same runtime from different angles:

- `demo/demoA-task-state` - task-state capture, revision history, and replay verification
- `demo/demoB-workflow-debug` - workflow debugging with execution replay and inspection

See `demo/README.md` for run commands.

## MCP support

Shadow Threads includes an MCP server in `mcp/`.

Dependency chain:

```text
MCP client -> Shadow Threads MCP -> Python SDK -> Shadow Threads server
```

Install and run:

```bash
pip install -e python-sdk
pip install -e mcp
shadowthreads-mcp
```

Exposed tools include artifact capture, revision creation, execution recording, and execution replay. See `mcp/README.md` for details.

## Architecture diagram

```mermaid
flowchart LR
    A[Python SDK / CLI / MCP] --> B[/api/v1 Local HTTP API]
    B --> C[Artifact Store]
    B --> D[Revision DAG]
    B --> E[Execution Records]
    B --> F[Migration / Closure]
    C --> G[(PostgreSQL)]
    D --> G
    E --> G
    F --> G
    B --> H[(Redis)]
```

Redis is used for runtime coordination and execution tracking.

## Use cases

- Record AI workflow state as immutable, content-addressed artifacts.
- Build revision history for package-local task progress.
- Audit model and tool executions with deterministic replay checks.
- Export and import migration packages with closure verification.
- Expose the same workflow boundary to local tools, SDK clients, CLI users, and MCP-compatible agents.

## Selftest Matrix

Shadow Threads selftests are organized into three execution tiers:

- `selftest:fast` - fast checks for active development and small changes.
- `selftest:core` - core runtime regression checks before merging logic changes.
- `selftest:full` - full regression checks, including HTTP E2E flows, before milestones or release candidates.

Example commands:

```bash
npm run build
npm run selftest:fast
npm run selftest:core
npm run selftest:full
```
