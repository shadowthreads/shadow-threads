export { diffState } from './semanticDiff/diffState';
export { applyDelta } from './stateTransition/applyDelta';
export { detectConflicts } from './stateTransition/detectConflicts';
export { computeNextStateFromRevisions } from './stateTransition/pipeline';
export { compressRevisionChain } from './lineage/compressRevisionChain';
export { buildAncestorPath, computeNetDeltaBetweenRevisions } from './lineage/netDelta';
export { findLowestCommonAncestor } from './lineage/lca';
export { computeCrossBranchNetDelta } from './lineage/crossBranchNetDelta';
