# Shadow Threads MCP v0

Shadow Threads MCP is a thin MCP server that exposes the validated Shadow Threads core actions as structured tools.

It is intended for:

- agent builders
- harness developers
- MCP-compatible AI clients
- workflow automation users

## Dependency chain

MCP depends on the Python SDK and the running Shadow Threads server.

The dependency chain is:

`MCP tools -> Python SDK -> Shadow Threads server`

This package is not the runtime itself.

## Tools

MCP v0 exposes these tools:

- `shadow_capture_artifact`
- `shadow_get_artifact`
- `shadow_create_revision`
- `shadow_get_revision`
- `shadow_list_revisions`
- `shadow_record_execution`
- `shadow_get_execution`
- `shadow_replay_execution`

## Server connection

The MCP server uses `SHADOW_SERVER` when set. Otherwise it defaults to:

```text
http://localhost:3001
```

## Install

From the repository root:

```bash
pip install -e python-sdk
pip install -e mcp
```

## Run

Start the MCP server over stdio:

```bash
shadowthreads-mcp
```

Or:

```bash
python -m shadowthreads_mcp.server
```

## Example tool usage

A connected MCP client can call tools such as:

- `shadow_capture_artifact`
- `shadow_create_revision`
- `shadow_record_execution`
- `shadow_replay_execution`

Example flow:

1. `shadow_capture_artifact`
2. `shadow_create_revision`
3. `shadow_record_execution`
4. `shadow_replay_execution`

## Error behavior

Tool failures return concise structured MCP error results with:

- `error_type`
- `status_code`
- `api_code`
- `message`

The MCP layer does not implement hashing, local replay semantics, or local protocol logic. It delegates those behaviors to the Python SDK and the Shadow Threads server.
