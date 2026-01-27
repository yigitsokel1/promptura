/**
 * Pure iteration logic
 * No side effects - only data transformations
 */

import type { Iteration, CandidatePrompt, RunResult } from '../types';

/**
 * Creates a new iteration with empty candidates and results
 */
export function createIteration(
  id: string,
  task: Iteration['task'],
  targetModel: Iteration['targetModel']
): Iteration {
  return {
    id,
    task,
    targetModel,
    candidates: [],
    results: [],
  };
}

/**
 * Adds candidate prompts to an iteration
 */
export function addCandidates(
  iteration: Iteration,
  candidates: CandidatePrompt[]
): Iteration {
  return {
    ...iteration,
    candidates: [...iteration.candidates, ...candidates],
  };
}

/**
 * Adds run results to an iteration
 */
export function addResults(
  iteration: Iteration,
  results: RunResult[]
): Iteration {
  return {
    ...iteration,
    results: [...iteration.results, ...results],
  };
}

/**
 * Gets a candidate by ID
 */
export function getCandidateById(
  iteration: Iteration,
  candidateId: string
): CandidatePrompt | undefined {
  return iteration.candidates.find((c) => c.id === candidateId);
}

/**
 * Gets a result by candidate ID
 */
export function getResultByCandidateId(
  iteration: Iteration,
  candidateId: string
): RunResult | undefined {
  return iteration.results.find((r) => r.candidateId === candidateId);
}

/**
 * Gets all candidate-result pairs
 */
export function getCandidateResultPairs(iteration: Iteration): Array<{
  candidate: CandidatePrompt;
  result: RunResult | undefined;
}> {
  return iteration.candidates.map((candidate) => ({
    candidate,
    result: getResultByCandidateId(iteration, candidate.id),
  }));
}

/**
 * Checks if an iteration is complete (all candidates have results)
 */
export function isIterationComplete(iteration: Iteration): boolean {
  return (
    iteration.candidates.length > 0 &&
    iteration.candidates.length === iteration.results.length &&
    iteration.candidates.every((c) =>
      iteration.results.some((r) => r.candidateId === c.id)
    )
  );
}
