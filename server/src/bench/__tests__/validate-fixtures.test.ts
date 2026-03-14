import { describe, expect, it } from 'vitest';

import { compareStrings, computeLineCol } from '../validate-fixtures';

describe('validate-fixtures helpers', () => {
  it('compareStrings uses deterministic lexicographic ordering', () => {
    expect(compareStrings('a', 'a')).toBe(0);
    expect(compareStrings('a', 'b')).toBe(-1);
    expect(compareStrings('b', 'a')).toBe(1);

    const input = ['zeta', 'alpha', 'beta'];
    const sorted = [...input].sort(compareStrings);
    expect(sorted).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('computeLineCol returns expected line, col, and lineText', () => {
    const text = 'first\n  second line\nthird';
    const pos = text.indexOf('s', 7);

    const result = computeLineCol(text, pos);

    expect(result).toEqual({
      line: 2,
      col: 3,
      lineText: '  second line',
    });
  });

  it('computeLineCol clamps invalid position to line 1 col 1', () => {
    const result = computeLineCol('alpha\nbeta', -12);

    expect(result).toEqual({
      line: 1,
      col: 1,
      lineText: 'alpha',
    });
  });
});
