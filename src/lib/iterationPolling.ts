/**
 * Idempotent polling guard: only apply status when it belongs to the active iteration.
 * Blok A + Blok F regression: "eski iteration overwrite edilmez".
 */

export interface StatusWithIterationId {
  iterationId: string;
}

/**
 * Returns true only when the status response is for the currently active iteration.
 * Prevents late/duplicate poll responses from overwriting state with an older iteration.
 */
export function shouldApplyStatusUpdate(
  activeIterationId: string | null,
  status: StatusWithIterationId
): boolean {
  return activeIterationId != null && status.iterationId === activeIterationId;
}
