# Apply Contract v0.2

Apply is not mutation. It is interpretation under constraint.

## Apply Input
```json
{
  "mode": "bootstrap | constrain | review",
  "userQuestion": "string"
}
```

## Apply Modes

### bootstrap
- Restate current state (facts, decisions, constraints).
- Then answer userQuestion.
- If information is missing:
  - Ask max 3 clarifying questions.
  - Explicitly state what is blocked.

### constrain
- Enforce constraints strictly.
- If userQuestion violates constraints or decisions:
  - Report conflict.
  - Provide safe alternative.
  - Then proceed.

### review
- First evaluate consistency:
  - userQuestion vs facts/decisions/assumptions.
- List gaps or risks.
- Then provide best possible answer with uncertainty noted.

## Conflict Handling Model

Mode: report_only

Rules:
- Conflicts are reported, never auto-resolved.
- Output must include:
  - conflictType
  - conflictingField
  - explanation
- Apply continues after reporting unless forbidden by constraints.

## Apply Output (logical contract)
```json
{
  "assistantReply": {
    "content": "string"
  },
  "applyReport": {
    "mode": "string",
    "conflicts": [
      {
        "conflictType": "state | constraint | assumption",
        "field": "string",
        "description": "string"
      }
    ],
    "usedFields": ["string"]
  }
}
```

## Versioning and Compatibility Rules
- v0.2 is additive over v0.1.
- v0.1 packages:
  - May be internally lifted to v0.2.
  - Must not be rejected.
- Unknown fields:
  - Must be ignored, not errored.
- Missing required v0.2 fields:
  - Must be reported in applyReport, not fatal.
