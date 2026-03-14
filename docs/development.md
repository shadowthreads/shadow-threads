# Shadow Threads Development

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
