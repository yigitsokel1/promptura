/**
 * Regression test: eski iteration overwrite edilmez (Blok F)
 */

import { shouldApplyStatusUpdate } from '../iterationPolling';

describe('shouldApplyStatusUpdate', () => {
  it('returns false when status is for a different iteration (old response must not overwrite)', () => {
    expect(shouldApplyStatusUpdate('iter_B', { iterationId: 'iter_A' })).toBe(false);
    expect(shouldApplyStatusUpdate('iter_2', { iterationId: 'iter_1' })).toBe(false);
  });

  it('returns true when status is for the active iteration', () => {
    expect(shouldApplyStatusUpdate('iter_A', { iterationId: 'iter_A' })).toBe(true);
  });

  it('returns false when active is null (no iteration selected)', () => {
    expect(shouldApplyStatusUpdate(null, { iterationId: 'iter_A' })).toBe(false);
  });
});
