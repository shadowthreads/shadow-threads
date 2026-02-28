# Shadow Threads EVAL-1 Summary

- Experiment: EVAL-1
- GeneratedAt: null

## t1_assumption_derived_stability (T1)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 0 | 0 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 0 | 0 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 0 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 0 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 0 | 0 |

## t1_constraint_violation_attempt (T1)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 2 | 2 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 2 | 2 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |

## t1_decision_answer_change (T1)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t1_facts_append_remove (T1)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t1_multi_domain_edit_small (T1)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t1_risk_update_from_fact (T1)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t2_assumptions_revision (T2)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t2_constraints_tightening (T2)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t2_long_context_summary_as_facts (T2)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t2_plan_decisions_multi_step (T2)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t2_risk_register_growth (T2)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t2_tradeoff_decision_flip (T2)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | false | null | null | null | null | null | null |
| B2_LLM_DELTA_STRICT | strict | false | null | null | null | null | null | null |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 1 |

## t3_conflict_add_existing (T3)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 1 | 0 | 1 | 0 | 0 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B2_LLM_DELTA_STRICT | strict | true | 1 | 1 | 0 | 1 | 0 | 0 |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |

## t3_conflict_modify_missing (T3)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B2_LLM_DELTA_STRICT | strict | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |

## t3_conflict_remove_missing (T3)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B2_LLM_DELTA_STRICT | strict | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |

## t3_multi_conflict_mixed (T3)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 2 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 2 | 0 | 1 | 0 | 0 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | true | 1 | 2 | 0 | 0 | 1 | 1 |
| B2_LLM_DELTA_STRICT | strict | true | 1 | 2 | 0 | 1 | 0 | 0 |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 1 | 0 | 0 |

## t3_partial_apply_expected (T3)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 1 | 0 | 1 | 0 | 0 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B2_LLM_DELTA_STRICT | strict | true | 1 | 1 | 0 | 1 | 0 | 0 |
| B3_STRICT_CLOSURE | strict | true | 1 | 0 | 0 | 2 | 0 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 0 | 0 | 2 | 0 | 0 |

## t3_strict_rollback_expected (T3)
| Baseline | Mode | Supported | HashStabilityRate | AvgConflictCount | AvgPostApplyConflictCount | AvgDistanceCountsSum | EqualsTargetRate | AssertionPassRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1_CORE_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B1_CORE_STRICT | strict | true | 1 | 2 | 1 | 1 | 0 | 0 |
| B1_PIPELINE | null | false | null | null | null | null | null | null |
| B2_LLM_DELTA_BEST_EFFORT | best_effort | true | 1 | 1 | 0 | 0 | 1 | 1 |
| B2_LLM_DELTA_STRICT | strict | true | 1 | 2 | 1 | 1 | 0 | 0 |
| B3_STRICT_CLOSURE | strict | true | 1 | 1 | 1 | 1 | 0 | 0 |
| B4_STRICT_RISK_CLOSURE | strict | true | 1 | 0 | 0 | 0 | 1 | 0 |
| B5_STRICT_CLOSURE_SUGGESTIONS | strict | true | 1 | 1 | 1 | 1 | 0 | 0 |
