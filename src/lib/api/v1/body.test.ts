import { describe, it, expect } from 'vitest';

import { optionalId } from './body';

describe('optionalId', () => {
  it('passes through a non-empty string', () => {
    expect(optionalId('abc-123')).toBe('abc-123');
  });

  it('treats an empty string as null (the bug this exists to catch)', () => {
    expect(optionalId('')).toBeNull();
  });

  it('treats a whitespace-only string as null', () => {
    expect(optionalId('   ')).toBeNull();
  });

  it('treats null/undefined/non-string values as null', () => {
    expect(optionalId(null)).toBeNull();
    expect(optionalId(undefined)).toBeNull();
    expect(optionalId(42)).toBeNull();
    expect(optionalId({})).toBeNull();
  });
});
