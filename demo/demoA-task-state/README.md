# Demo A: Task State Management

## Problem

AI-assisted tasks often lose state as a conversation grows. People forget what step they are on, what already happened, and what the current task output means.

## Solution

Shadow Threads makes task state explicit. This demo records a simple AI-assisted task as visible steps, a stored revision, and an inspectable execution history.

This demo is not about continuing a conversation.

It shows explicit task state continuity.

This demo primarily shows task state continuity, progress, and history.
It also ends with replay verification of the recorded execution.

## Demo steps

1. Initialize a local Shadow workspace.
2. Capture the starting task artifact for a log parser task.
3. Run a tiny workflow that shows task progress:
   - `Step 1 Load data`
   - `Step 2 Parse logs`
   - `Step 3 Generate summary`
4. Record the updated task state and execution history behind the script.
5. Inspect the stored revision and the stored execution.
6. Replay the recorded execution boundary for a final verification step.

## Expected output

You should see the workflow progress first:

```text
Step 1 Load data
Step 2 Parse logs
Step 3 Generate summary
```

Then the script inspects:

- a revision that represents the latest task state
- an execution record that shows the workflow history for that task
- a replay verification step that confirms the recorded execution boundary still matches

## Run

From the repository root:

```bash
cd demo/demoA-task-state
bash run-demo.sh
```

On Windows PowerShell:

```powershell
Set-Location demo/demoA-task-state
.\run-demo.ps1
```

The script uses `SHADOW_SERVER` if it is set. Otherwise it defaults to `http://localhost:3001`.
