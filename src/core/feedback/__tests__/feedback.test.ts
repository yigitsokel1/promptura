import {
  validateFeedback,
  getSelectedFeedback,
  getFeedbackWithNotes,
  createRefineRequest,
  getSelectedCandidateIds,
  getFeedbackStats,
} from '../feedback';
import type { Iteration, FeedbackItem } from '../../types';

describe('feedback', () => {
  const mockIteration: Iteration = {
    id: 'iter-1',
    task: {
      goal: 'Test task',
      modality: 'text-to-text',
    },
    targetModel: {
      provider: 'falai',
      modelId: 'test-model',
    },
    candidates: [
      { id: 'candidate-1', prompt: 'Prompt 1', generator: 'self' },
      { id: 'candidate-2', prompt: 'Prompt 2', generator: 'self' },
      { id: 'candidate-3', prompt: 'Prompt 3', generator: 'self' },
    ],
    results: [],
  };

  describe('validateFeedback', () => {
    it('should return valid=true for feedback with valid candidate IDs', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true },
        { candidateId: 'candidate-2', selected: false },
      ];

      const result = validateFeedback(mockIteration, feedback);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return valid=false for feedback with invalid candidate IDs', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true },
        { candidateId: 'invalid-id', selected: false },
      ];

      const result = validateFeedback(mockIteration, feedback);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Invalid candidateId: invalid-id not found in iteration'
      );
    });

    it('should handle empty feedback array', () => {
      const result = validateFeedback(mockIteration, []);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getSelectedFeedback', () => {
    it('should return only selected feedback items', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true },
        { candidateId: 'candidate-2', selected: false },
        { candidateId: 'candidate-3', selected: true },
      ];

      const selected = getSelectedFeedback(feedback);
      expect(selected).toHaveLength(2);
      expect(selected.every((item) => item.selected)).toBe(true);
      expect(selected.map((item) => item.candidateId)).toEqual([
        'candidate-1',
        'candidate-3',
      ]);
    });

    it('should return empty array when no items are selected', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: false },
        { candidateId: 'candidate-2', selected: false },
      ];

      const selected = getSelectedFeedback(feedback);
      expect(selected).toHaveLength(0);
    });
  });

  describe('getFeedbackWithNotes', () => {
    it('should return only feedback items with notes', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true, note: 'Good prompt' },
        { candidateId: 'candidate-2', selected: false },
        { candidateId: 'candidate-3', selected: true, note: '   ' }, // whitespace only
        { candidateId: 'candidate-1', selected: true, note: 'Another note' },
      ];

      const withNotes = getFeedbackWithNotes(feedback);
      expect(withNotes).toHaveLength(2);
      expect(withNotes.every((item) => item.note && item.note.trim().length > 0)).toBe(
        true
      );
    });

    it('should filter out empty or whitespace-only notes', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true, note: '' },
        { candidateId: 'candidate-2', selected: false, note: '   ' },
        { candidateId: 'candidate-3', selected: true }, // no note
      ];

      const withNotes = getFeedbackWithNotes(feedback);
      expect(withNotes).toHaveLength(0);
    });
  });

  describe('createRefineRequest', () => {
    it('should create a refine request with iteration ID and feedback', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true, note: 'Good' },
        { candidateId: 'candidate-2', selected: false },
      ];

      const request = createRefineRequest('iter-1', feedback);
      expect(request.iterationId).toBe('iter-1');
      expect(request.feedback).toEqual(feedback);
    });
  });

  describe('getSelectedCandidateIds', () => {
    it('should extract candidate IDs from selected feedback', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true },
        { candidateId: 'candidate-2', selected: false },
        { candidateId: 'candidate-3', selected: true },
      ];

      const ids = getSelectedCandidateIds(feedback);
      expect(ids).toEqual(['candidate-1', 'candidate-3']);
    });

    it('should return empty array when no items are selected', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: false },
      ];

      const ids = getSelectedCandidateIds(feedback);
      expect(ids).toEqual([]);
    });
  });

  describe('getFeedbackStats', () => {
    it('should return correct statistics', () => {
      const feedback: FeedbackItem[] = [
        { candidateId: 'candidate-1', selected: true, note: 'Note 1' },
        { candidateId: 'candidate-2', selected: false },
        { candidateId: 'candidate-3', selected: true },
        { candidateId: 'candidate-4', selected: false, note: 'Note 2' },
      ];

      const stats = getFeedbackStats(feedback);
      expect(stats.total).toBe(4);
      expect(stats.selected).toBe(2);
      expect(stats.withNotes).toBe(2);
    });

    it('should handle empty feedback', () => {
      const stats = getFeedbackStats([]);
      expect(stats.total).toBe(0);
      expect(stats.selected).toBe(0);
      expect(stats.withNotes).toBe(0);
    });
  });
});
