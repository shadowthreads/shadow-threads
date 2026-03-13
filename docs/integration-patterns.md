# Shadow Threads Integration Patterns

Shadow Threads can be integrated at different points in an AI workflow depending on what you need to control.

Some teams only want deterministic replay for a single model boundary. Others want to persist workflow state, audit agent steps, or branch state to compare different strategies. The core objects stay the same:

- `artifact` stores a workflow payload
- `revision` binds artifacts into a state snapshot
- `execution` records a model or tool boundary
- `replay` verifies a recorded execution boundary

You can use these objects through the HTTP API directly, through the Python SDK, through the CLI, or through MCP tools. The patterns below focus on how developers typically wire them into real systems.

## 1. Deterministic workflow replay

Use this pattern when you need to verify a recorded model or tool step later.

Typical cases:

- debugging AI coding pipelines
- verifying model output boundaries
- checking whether an execution changed after a code or prompt update

### How it works

The workflow records both state and execution boundaries in a fixed order:

1. Capture the input or task artifact.
2. Create a revision that references that artifact.
3. Record the execution boundary with prompt hash, parameters, input artifacts, output artifacts, and status.
4. Replay the execution later to verify that the recorded boundary still matches.

Conceptually:

```text
artifact -> revision -> execution -> replay verification
```

The important point is that replay is not a best-effort rerun. It verifies the recorded execution boundary.

### Typical API calls

- `POST /api/v1/artifacts`
- `POST /api/v1/revisions`
- `POST /api/v1/executions`
- `POST /api/v1/executions/:executionId/replay`

### Minimal code shape

```python
from shadowthreads import ArtifactReference, RevisionMetadata, ShadowClient

with ShadowClient(base_url="http://localhost:3001") as client:
    artifact = client.capture_artifact(
        schema="workflow.input.v1",
        package_id="debug-pipeline",
        payload={"task": "generate patch", "input": "..."},
    )

    ref = ArtifactReference(bundle_hash=artifact.bundle_hash, role="workflow_input")

    revision = client.create_revision(
        package_id="debug-pipeline",
        artifacts=[ref],
        metadata=RevisionMetadata(
            author="CI",
            message="Record workflow input",
            created_by="pipeline",
            timestamp="2026-03-14T09:00:00+00:00",
            source="system",
        ),
    )

    execution = client.record_execution(
        package_id="debug-pipeline",
        revision_hash=revision.revision_hash,
        provider="openai",
        model="gpt-5",
        prompt_hash="...",
        parameters={"temperature": 0},
        input_artifacts=[ref],
        output_artifacts=[ref],
        status="success",
        started_at="2026-03-14T09:00:00+00:00",
        finished_at="2026-03-14T09:00:02+00:00",
    )

    replay = client.replay_execution(execution.execution_id)
```

### When to use it

Use this pattern if the main problem is: "I need to prove what happened at one workflow boundary."

This is usually the first Shadow Threads integration because it requires the smallest surface area and immediately improves debugging.

## 2. Workflow state portability

Use this pattern when workflow state needs to move across machines, environments, or model providers without relying on local memory.

Typical cases:

- switching model providers
- resuming workflows
- moving pipelines between environments

### How it works

Artifacts capture the actual workflow payload. Revisions bind those artifacts into a deterministic state snapshot. Once state is recorded that way, another process can load the same artifact and revision history and continue from the same boundary.

Conceptually:

```text
capture state -> create revision -> export or fetch later -> reconstruct state elsewhere
```

This is useful when you want portability at the workflow-state level, not just output logs.

### Typical API calls

- `POST /api/v1/artifacts`
- `POST /api/v1/revisions`
- `GET /api/v1/revisions/:revisionHash`
- `GET /api/v1/artifacts/:packageId/:bundleHash`

If you need to move a larger closure of state between environments, migration endpoints can sit on top of the same revision and artifact graph:

- `POST /api/v1/migration/export`
- `POST /api/v1/migration/verify`
- `POST /api/v1/migration/import`

### Minimal code shape

```python
revision = client.create_revision(
    package_id="portable-workflow",
    artifacts=[
        ArtifactReference(bundle_hash=input_hash, role="workflow_input"),
        ArtifactReference(bundle_hash=context_hash, role="context"),
    ],
    metadata=RevisionMetadata(
        author="workflow-runner",
        message="Checkpoint before provider switch",
        created_by="scheduler",
        timestamp="2026-03-14T09:00:00+00:00",
        source="system",
    ),
)

restored_revision = client.get_revision(revision.revision_hash)

for artifact_ref in restored_revision.artifacts:
    artifact = client.get_artifact(restored_revision.package_id, artifact_ref.bundle_hash)
```

### When to use it

Use this pattern if the main problem is: "I need to continue the same workflow state somewhere else."

That can mean moving from local development to CI, moving from one provider to another, or resuming a paused workflow without reconstructing hidden context by hand.

## 3. Agent execution audit

Use this pattern when an agent framework performs multiple steps and you want each step to leave behind an inspectable execution record.

Typical cases:

- tool tracing
- reasoning audit
- debugging agent decisions

### How it works

Each agent step records:

- the current revision it ran against
- the prompt or step identity
- parameters
- input artifacts
- output artifacts
- final status

This gives you an audit trail at the execution boundary instead of relying only on logs.

Conceptually:

```text
agent step N
  -> read revision
  -> call tool or model
  -> write output artifact
  -> record execution
  -> create next revision
```

You can repeat that loop for every model call or tool invocation that matters.

### Typical API calls

- `POST /api/v1/executions`
- `GET /api/v1/executions/:executionId`
- `POST /api/v1/artifacts`
- `POST /api/v1/revisions`

### Minimal code shape

```python
step_output = client.capture_artifact(
    schema="agent.tool.output.v1",
    package_id="agent-run-42",
    payload={"tool": "search", "result": "..."},
)

output_ref = ArtifactReference(bundle_hash=step_output.bundle_hash, role="tool_output")

execution = client.record_execution(
    package_id="agent-run-42",
    revision_hash=current_revision_hash,
    provider="agent-runtime",
    model="tool-search-step",
    prompt_hash="...",
    parameters={"step": "search"},
    input_artifacts=input_refs,
    output_artifacts=[output_ref],
    status="success",
    started_at="2026-03-14T09:00:00+00:00",
    finished_at="2026-03-14T09:00:01+00:00",
)

next_revision = client.create_revision(
    package_id="agent-run-42",
    parent_revision_hash=current_revision_hash,
    artifacts=input_refs + [output_ref],
    metadata=RevisionMetadata(
        author="agent-runtime",
        message="Recorded search step output",
        created_by="agent-loop",
        timestamp="2026-03-14T09:00:01+00:00",
        source="ai",
    ),
)
```

### When to use it

Use this pattern if the main problem is: "The agent made a decision, but I cannot tell which state and inputs produced it."

It is especially useful for multi-step harnesses where logs alone are too loose and you need a stable audit trail per step.

## 4. Branchable workflow state

Use this pattern when you want to fork from one known revision and evaluate multiple next steps in parallel.

Typical cases:

- testing alternative tool strategies
- exploring reasoning paths
- parallel workflow experiments

### How it works

A revision can act as a stable parent state. From that parent, you can create multiple child revisions that reference different artifacts or outputs.

Conceptual diagram:

```text
R1
|- R2 branch A
`- R3 branch B
```

Each branch keeps a deterministic record of what changed from the same starting point. That makes comparison easier because both branches share the same parent state.

### Typical API calls

- `POST /api/v1/revisions`
- `GET /api/v1/revisions/:revisionHash`
- `POST /api/v1/artifacts`
- optionally `POST /api/v1/executions` for each branch step

### Minimal code shape

```python
branch_a = client.create_revision(
    package_id="planner",
    parent_revision_hash="R1",
    artifacts=[ArtifactReference(bundle_hash="...", role="strategy_a")],
    metadata=RevisionMetadata(
        author="planner",
        message="Try branch A",
        created_by="experiment-runner",
        timestamp="2026-03-14T09:00:00+00:00",
        source="system",
    ),
)

branch_b = client.create_revision(
    package_id="planner",
    parent_revision_hash="R1",
    artifacts=[ArtifactReference(bundle_hash="...", role="strategy_b")],
    metadata=RevisionMetadata(
        author="planner",
        message="Try branch B",
        created_by="experiment-runner",
        timestamp="2026-03-14T09:00:00+00:00",
        source="system",
    ),
)
```

### When to use it

Use this pattern if the main problem is: "I need to compare multiple next states without losing the original baseline."

This is common in planning systems, agent strategy search, and evaluation harnesses where several candidate paths should remain explicit instead of being overwritten in place.

## Choosing a pattern

In practice, most integrations start with one of these:

- Start with deterministic workflow replay if you need verification at a single workflow boundary.
- Start with workflow state portability if you need to move or resume state across environments.
- Start with agent execution audit if your system already has a step loop and you need traceability.
- Start with branchable workflow state if you need to compare multiple candidate next states from the same parent.

These patterns compose cleanly. A single system can record agent steps, branch revisions for experiments, and replay selected executions for verification using the same artifact, revision, and execution model.
