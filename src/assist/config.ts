/**
 * Assist tuning (contract 08). Rules first, correlation as the tie-breaker:
 * `score = RULE_WEIGHT · prior + (1 − RULE_WEIGHT) · |r|`.
 */
export const RULE_WEIGHT = 0.6;
/** Rows shown. */
export const ASSIST_TOP = 5;
/** Runs needed before a correlation means anything. */
export const ASSIST_MIN_RUNS = 3;
