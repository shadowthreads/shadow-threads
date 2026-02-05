# TaskPackage Protocol v0.2 (Schema)

This document defines the TaskPackage v0.2 structure and field semantics.
All top-level fields listed below are required. Inner fields may be optional only where specified.

## Top-level structure (required)
```json
{
  "manifest": { ... },
  "intent": { ... },
  "state": { ... },
  "constraints": { ... },
  "interfaces": { ... },
  "risks": [ ... ],
  "evidence": [ ... ],
  "history": { ... },
  "compat": { ... }
}
```

## manifest
Purpose: identity, versioning, and lifecycle metadata.

```json
{
  "schemaVersion": "tpkg-0.2",
  "packageId": "string (uuid, optional)",
  "createdAt": "ISO-8601 datetime string",
  "updatedAt": "ISO-8601 datetime string",
  "title": "string",
  "description": "string (optional)",
  "capabilities": {
    "applyModes": ["bootstrap", "constrain", "review"],
    "conflictHandling": "report_only"
  }
}
```

Notes:
- schemaVersion must be "tpkg-0.2".
- capabilities declares what an Apply engine is allowed to do.
- No capability implies permission.

## intent
Purpose: current goal and success criteria.

```json
{
  "primary": "string",
  "successCriteria": ["string"],
  "nonGoals": ["string"]
}
```

Semantics:
- primary answers "what is being advanced now".
- successCriteria are testable outcomes.
- nonGoals explicitly constrain scope.

## state
Purpose: machine-readable project state.

```json
{
  "facts": ["string"],
  "decisions": ["string"],
  "assumptions": ["string"],
  "openLoops": ["string"]
}
```

Rules:
- These are assertions, not summaries.
- Apply must not contradict facts or decisions.

## constraints
Purpose: hard limits the Apply engine must obey.

```json
{
  "technical": ["string"],
  "process": ["string"],
  "policy": ["string"]
}
```

Semantics:
- Violating constraints is never allowed.
- If user intent conflicts, it must be reported.

## interfaces
Purpose: known system boundaries and contracts.

```json
{
  "apis": [
    {
      "name": "string",
      "type": "http | function | cli | other",
      "contract": "string"
    }
  ],
  "modules": ["string"]
}
```

## risks
Purpose: known risk surface.

```json
[
  {
    "id": "string",
    "description": "string",
    "severity": "low | medium | high",
    "mitigation": "string (optional)"
  }
]
```

## evidence
Purpose: traceability, not storytelling.

```json
[
  {
    "type": "snapshot | selection | delta | external",
    "sourceId": "string",
    "summary": "string"
  }
]
```

Rules:
- Evidence supports state; it does not override it.

## history
Purpose: lineage and evolution.

```json
{
  "origin": "snapshot | import | manual",
  "derivedFrom": "packageId (optional)",
  "revision": 0
}
```

## compat
Backward compatibility rules.

```json
{
  "accepts": ["tpkg-0.1"],
  "downgradeStrategy": "lossy-allowed"
}
```

Semantics:
- v0.2 Apply engines must accept v0.1 packages.
- Downgrade may drop fields but must not alter facts.
