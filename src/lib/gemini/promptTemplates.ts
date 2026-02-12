/**
 * Gemini Prompt Contract v2 — single source of truth for all prompts sent to Gemini.
 * Sprint 4: Quality focus — longer, scene-descriptive prompts; refine that truly evolves.
 */

import type { TaskSpec, RunOutput } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';

/** Turn run output into a short summary for Gemini (no raw JSON). */
export function summarizeRunOutput(output: RunOutput | null | undefined): string {
  if (!output) return 'No output';
  switch (output.type) {
    case 'text':
      if (!output.text?.trim()) return 'Empty text output';
      const text = output.text.trim();
      const maxLen = 280;
      return text.length <= maxLen ? text : text.slice(0, maxLen) + '…';
    case 'image':
      const n = output.images?.length ?? 0;
      return n === 1 ? 'Generated 1 image' : `Generated ${n} images`;
    case 'video':
      const v = output.videos?.length ?? 0;
      return v === 1 ? 'Generated 1 video' : `Generated ${v} videos`;
    default:
      return 'Output received';
  }
}

/** One prompt item in Gemini's response. reasoning + tags drive quality and future UX. */
export interface GeminiPromptItem {
  prompt: string;
  reasoning: string;
  tags: string[];
  params?: Record<string, unknown>;
  inputAssets?: Record<string, string>;
}

/** Contract: Gemini must return this exact shape for both generate and refine. */
export interface GeminiPromptsResponse {
  prompts: GeminiPromptItem[];
}

function formatInputs(modelSpec: ModelSpec): string {
  return modelSpec.inputs
    .map((input) => {
      let line = `- ${input.name} (${input.type}${input.required ? ', required' : ', optional'})`;
      if (input.min !== undefined || input.max !== undefined) {
        line += ` [range: ${input.min ?? 'any'} to ${input.max ?? 'any'}]`;
      }
      if (input.enum?.length) {
        line += ` [Allowed values ONLY: ${input.enum.map((v) => `'${v}'`).join(', ')}]`;
      }
      if (input.description) line += `: ${input.description}`;
      return line;
    })
    .join('\n');
}

function formatRecommendedRanges(modelSpec: ModelSpec): string {
  if (!modelSpec.recommended_ranges) return 'None specified';
  return Object.entries(modelSpec.recommended_ranges)
    .map(([param, [min, max]]) => `- ${param}: ${min} to ${max}`)
    .join('\n');
}

function formatGuidelines(modelSpec: ModelSpec): string {
  return modelSpec.prompt_guidelines
    .map((g, i) => `${i + 1}. ${g}`)
    .join('\n');
}

/**
 * Build the prompt sent to Gemini for initial prompt generation.
 * Emphasizes long, scene-descriptive prompts (sahne anlatımlı).
 */
export function generatePrompts(
  task: TaskSpec,
  modelSpec: ModelSpec,
  count: number
): string {
  const inputsDescription = formatInputs(modelSpec);
  const recommendedRangesText = formatRecommendedRanges(modelSpec);
  const guidelinesText = formatGuidelines(modelSpec);
  const outputType = modelSpec.outputs.type;
  const outputFormat = modelSpec.outputs.format;

  return `You are an expert prompt engineer. Generate exactly ${count} diverse, high-quality candidate prompts for the following task.

## Task
- Goal: ${task.goal}
- Modality: ${task.modality}

CRITICAL: All prompts must be written in English. If the task goal is in another language, translate the intent to English and write the prompts in English.

## Model context
${modelSpec.summary ? `Summary: ${modelSpec.summary}\n` : ''}
Inputs:
${inputsDescription}

Recommended parameter ranges:
${recommendedRangesText}

Prompt writing guidelines (follow strictly):
${guidelinesText}

Output: ${outputType}, format: ${outputFormat}${modelSpec.outputs.description ? ` — ${modelSpec.outputs.description}` : ''}

## Your job
1. Write LONG, SCENE-DESCRIPTIVE prompts. Each prompt should describe the scene, mood, composition, lighting, style, and any motion or detail that matters for the output. Short one-liners are not acceptable unless the model explicitly favors them.
2. Generate exactly ${count} prompts. Vary approach (e.g. style, perspective, emphasis) so we explore different directions.
3. For each prompt you must also provide:
   - reasoning: 1–2 sentences on why this prompt is strong (e.g. clarity, specificity, alignment with guidelines).
   - tags: 3–6 short tags such as style, motion, lighting, composition, mood, subject (lowercase, English).
4. Optionally include params (e.g. steps, cfg_scale) and inputAssets only when the model needs them; use recommended ranges for numeric params and only allowed enum values for string params.

## Required JSON shape (return ONLY this, no markdown/code fences)
{
  "prompts": [
    {
      "prompt": "full scene-descriptive prompt in English",
      "reasoning": "why this prompt is effective",
      "tags": ["tag1", "tag2", "tag3"],
      "params": {},
      "inputAssets": {}
    }
  ]
}

Return ONLY the JSON object, no other text.`;
}

/** Selected candidate with optional note and run output summary (for refine context). */
export interface SelectedWithNote {
  prompt: string;
  note?: string;
  /** Short summary of what the model produced (no raw JSON). */
  outputSummary?: string;
}

/**
 * Build the prompt sent to Gemini for refinement.
 * Emphasizes evolution: refined prompts must clearly build on and improve the selected ones (gerçekten evrilmiş).
 */
export function refinePrompts(
  task: TaskSpec,
  modelSpec: ModelSpec,
  selected: SelectedWithNote[],
  count: number
): string {
  const inputsDescription = formatInputs(modelSpec);
  const recommendedRangesText = formatRecommendedRanges(modelSpec);
  const guidelinesText = formatGuidelines(modelSpec);
  const outputType = modelSpec.outputs.type;
  const outputFormat = modelSpec.outputs.format;

  const selectedBlock = selected
    .map((s, i) => {
      const noteLine = s.note ? `\n   User note: ${s.note}` : '';
      const outputLine = s.outputSummary ? `\n   Model output (summary): ${s.outputSummary}` : '';
      return `${i + 1}. ${s.prompt}${noteLine}${outputLine}`;
    })
    .join('\n\n');

  return `You are an expert prompt engineer. The user has selected the following prompts from a previous iteration and wants you to EVOLVE them into ${count} new, improved prompts. Use the "Model output (summary)" to see what the model actually produced for each prompt—your refined prompts should build on what worked.

## Task (unchanged)
- Goal: ${task.goal}
- Modality: ${task.modality}

## Selected prompts to evolve (do not copy; improve and diversify)
${selectedBlock}

## Model context
${modelSpec.summary ? `Summary: ${modelSpec.summary}\n` : ''}
Inputs:
${inputsDescription}

Recommended parameter ranges:
${recommendedRangesText}

Prompt writing guidelines (follow strictly):
${guidelinesText}

Output: ${outputType}, format: ${outputFormat}${modelSpec.outputs.description ? ` — ${modelSpec.outputs.description}` : ''}

## Your job
1. EVOLVE the selected prompts: take what worked (clarity, structure, appeal) and produce new prompts that are clearly better or different—different angles, stronger scene description, better alignment with guidelines. The new prompts must feel like a clear evolution, not a copy-paste.
2. Keep prompts LONG and SCENE-DESCRIPTIVE. Add or refine detail (lighting, motion, style, composition) where it helps.
3. Generate exactly ${count} prompts. Vary them so we explore multiple directions.
4. For each prompt provide:
   - reasoning: 1–2 sentences on how this evolved from the selection and why it is stronger.
   - tags: 3–6 short tags (e.g. style, motion, lighting — lowercase, English).
5. Optionally include params and inputAssets when the model needs them; use recommended ranges and only allowed enum values.

## Required JSON shape (return ONLY this, no markdown/code fences)
{
  "prompts": [
    {
      "prompt": "evolved, scene-descriptive prompt in English",
      "reasoning": "how this evolved and why it is better",
      "tags": ["tag1", "tag2", "tag3"],
      "params": {},
      "inputAssets": {}
    }
  ]
}

Return ONLY the JSON object, no other text.`;
}
