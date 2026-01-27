/**
 * Feedback shaping logic
 * Pure functions for processing user feedback
 */

import type { FeedbackItem, RefineRequest, Iteration } from '../types';

/**
 * Validates that all feedback items reference valid candidate IDs
 */
export function validateFeedback(
  iteration: Iteration,
  feedback: FeedbackItem[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const candidateIds = new Set(iteration.candidates.map((c) => c.id));

  for (const item of feedback) {
    if (!candidateIds.has(item.candidateId)) {
      errors.push(
        `Invalid candidateId: ${item.candidateId} not found in iteration`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Gets only selected feedback items
 */
export function getSelectedFeedback(
  feedback: FeedbackItem[]
): FeedbackItem[] {
  return feedback.filter((item) => item.selected);
}

/**
 * Gets feedback items with notes
 */
export function getFeedbackWithNotes(
  feedback: FeedbackItem[]
): FeedbackItem[] {
  return feedback.filter((item) => item.note && item.note.trim().length > 0);
}

/**
 * Creates a refine request from feedback
 */
export function createRefineRequest(
  iterationId: string,
  feedback: FeedbackItem[]
): RefineRequest {
  return {
    iterationId,
    feedback,
  };
}

/**
 * Extracts selected candidate IDs from feedback
 */
export function getSelectedCandidateIds(feedback: FeedbackItem[]): string[] {
  return getSelectedFeedback(feedback).map((item) => item.candidateId);
}

/**
 * Counts selected vs total feedback items
 */
export function getFeedbackStats(feedback: FeedbackItem[]): {
  total: number;
  selected: number;
  withNotes: number;
} {
  return {
    total: feedback.length,
    selected: getSelectedFeedback(feedback).length,
    withNotes: getFeedbackWithNotes(feedback).length,
  };
}
