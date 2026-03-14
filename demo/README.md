# Shadow Threads Demo Layer

These two demos show the same runtime from two different product angles.

| Demo | Audience | Shows |
| --- | --- | --- |
| Demo A | AI collaboration beginners | task state, progress, history |
| Demo B | workflow engineers | execution replay, debugging |

## Prerequisites

- The Shadow Threads server is already running at `http://localhost:3001`.
- To use a different server, set `SHADOW_SERVER`, for example: `export SHADOW_SERVER=http://localhost:3001`
- The CLI is already built before running the demos.
- Python 3 is available.

If the `shadow` command is not on your `PATH`, the demo scripts will use the built CLI at `cli/dist/index.js`.

To build the CLI:

```bash
cd cli
npm run build
```

## Run the demos

Demo A:

```bash
cd demo/demoA-task-state
bash run-demo.sh
```

```powershell
Set-Location demo/demoA-task-state
.\run-demo.ps1
```

Demo B:

```bash
cd demo/demoB-workflow-debug
bash run-debug.sh
```

```powershell
Set-Location demo/demoB-workflow-debug
.\run-debug.ps1
```

Each demo is designed to finish in under five minutes.
