# Debug AI workflows with replayable execution history

## Problem

AI workflows are difficult to debug. Failures are often hard to explain later because the exact execution boundary was never recorded in a reliable way.

## Solution

Shadow Threads records execution history as a stable boundary that can be inspected and replayed for verification. This demo captures a failure at step 2, inspects the execution record, and then verifies that record with replay.

## Demo steps

1. Initialize a local Shadow workspace.
2. Capture the workflow input state.
3. Run a workflow that fails during the transform step.
4. Record the failed execution boundary behind the script.
5. Inspect the execution history.
6. Replay the recorded execution boundary with `shadow replay`.

## Expected output

The visible workflow failure looks like this:

```text
Step 1 OK
Step 2 FAILED
```

Later in the run, the script prints:

```text
Replaying recorded execution boundary
```

`shadow replay` verifies the recorded execution boundary. It is not presented as a local rerun of the broken code path.

## Run

From the repository root:

```bash
cd demo/demoB-workflow-debug
bash run-debug.sh
```

On Windows PowerShell:

```powershell
Set-Location demo/demoB-workflow-debug
.\run-debug.ps1
```

The script uses `SHADOW_SERVER` if it is set. Otherwise it defaults to `http://localhost:3001`.
