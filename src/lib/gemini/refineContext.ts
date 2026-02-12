/**
 * Refine context builder: builds selected items (prompt + note + outputSummary) for Gemini.
 * Blok F: unit-testable; used by refine route.
 */

import { summarizeRunOutput } from './promptTemplates';
import type { RunOutput } from '@/src/core/types';
import type { SelectedWithNote } from './promptTemplates';

export interface SelectedFeedbackItem {
  candidateId: string;
  note?: string;
  selected: boolean;
}

export interface SelectedPromptItem {
  candidateId: string;
  prompt: string;
  note?: string;
}

export interface RunWithOutput {
  candidateId: string;
  outputJson?: RunOutput | null;
}

/**
 * Build selected-for-refine context: prompt text, user note, and run output summary per selected item.
 */
export function buildRefineContext(
  selectedFeedback: SelectedFeedbackItem[],
  selectedPrompts: SelectedPromptItem[] | undefined,
  previousRuns: RunWithOutput[]
): SelectedWithNote[] {
  return selectedFeedback.map((item) => {
    const withText = selectedPrompts?.find((s) => s.candidateId === item.candidateId);
    const run = previousRuns.find((r) => r.candidateId === item.candidateId);
    const output = run?.outputJson ?? undefined;
    return {
      prompt: withText?.prompt ?? `Selected candidate ${item.candidateId}`,
      note: item.note,
      outputSummary: summarizeRunOutput(output),
    };
  });
}
