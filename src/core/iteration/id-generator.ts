/**
 * Iteration ID generation
 * Centralized ID generation logic
 */

/**
 * Generate a unique iteration ID
 * Format: iter_{timestamp}_{random}
 */
export function generateIterationId(): string {
  return `iter_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}
