/**
 * Gemini Prompt Contract v2 — single source of truth for all prompts sent to Gemini.
 * Sprint 4: Quality focus — longer, scene-descriptive prompts; refine that truly evolves.
 */

import type { TaskSpec, OutputAsset } from '@/src/core/types';
import type { ModelSpec } from '@/src/core/modelSpec';
import { modelSpecNeedsImage, modelSpecNeedsVideo, modelSpecOutputType } from '@/src/core/modelSpec';

/** Turn run output (OutputAsset[] or legacy RunOutput) into a short summary for Gemini. */
export function summarizeRunOutput(
  output: OutputAsset[] | { type: string; text?: string; images?: { url: string }[]; videos?: { url: string }[] } | null | undefined
): string {
  if (!output) return 'No output';
  if (Array.isArray(output)) {
    if (output.length === 0) return 'No output';
    const texts = output.filter((a): a is OutputAsset & { type: 'text' } => a.type === 'text');
    const images = output.filter((a): a is OutputAsset & { type: 'image' } => a.type === 'image');
    const videos = output.filter((a): a is OutputAsset & { type: 'video' } => a.type === 'video');
    if (texts.length > 0) {
      const text = texts.map((t) => t.content).join(' ').trim();
      if (!text) return 'Empty text output';
      const maxLen = 280;
      return text.length <= maxLen ? text : text.slice(0, maxLen) + '…';
    }
    if (images.length > 0) return images.length === 1 ? 'Generated 1 image' : `Generated ${images.length} images`;
    if (videos.length > 0) return videos.length === 1 ? 'Generated 1 video' : `Generated ${videos.length} videos`;
    return 'Output received';
  }
  const legacy = output as { type: string; text?: string; images?: { url: string }[]; videos?: { url: string }[] };
  if (legacy.type === 'text' && legacy.text?.trim()) {
    const text = legacy.text.trim();
    return text.length <= 280 ? text : text.slice(0, 280) + '…';
  }
  if (legacy.type === 'image' && legacy.images?.length) {
    return legacy.images.length === 1 ? 'Generated 1 image' : `Generated ${legacy.images.length} images`;
  }
  if (legacy.type === 'video' && legacy.videos?.length) {
    return legacy.videos.length === 1 ? 'Generated 1 video' : `Generated ${legacy.videos.length} videos`;
  }
  return 'Output received';
}

/** One prompt item in Gemini's response. reasoning + tags drive quality and future UX. */
export interface GeminiPromptItem {
  prompt: string;
  reasoning: string;
  tags: string[];
  inputAssets?: Record<string, string>;
}

/** Contract: Gemini must return this exact shape for both generate and refine. */
export interface GeminiPromptsResponse {
  prompts: GeminiPromptItem[];
}

/** Only prompt-relevant context: whether image/video input is needed (from required_assets). */
function formatPromptContext(modelSpec: ModelSpec): string {
  const needsImage = modelSpecNeedsImage(modelSpec);
  const needsVideo = modelSpecNeedsVideo(modelSpec);
  const parts: string[] = [];
  if (needsImage) parts.push('Requires image input (user will provide)');
  if (needsVideo) parts.push('Requires video input (user will provide)');
  if (parts.length === 0) return 'Text-only prompt input';
  return parts.join('. ');
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
  const promptContext = formatPromptContext(modelSpec);
  const guidelinesText = formatGuidelines(modelSpec);
  const outputType = modelSpecOutputType(modelSpec);
  const outputFormat = outputType === 'image' || outputType === 'video' ? 'url[]' : 'string';

  return `You are an expert prompt engineer. Generate exactly ${count} diverse, high-quality candidate prompts for the following task.

## Task
- Goal: ${task.goal}
- Modality: ${task.modality}

CRITICAL: All prompts must be written in English. If the task goal is in another language, translate the intent to English and write the prompts in English.

## Model context (prompt writing only — no params)
${modelSpec.summary ? `Summary: ${modelSpec.summary}\n` : ''}
Input: ${promptContext}

Prompt writing guidelines (follow strictly):
${guidelinesText}

Output: ${outputType}, format: ${outputFormat}

## Your job
1. Write LONG, SCENE-DESCRIPTIVE prompts. Each prompt should describe the scene, mood, composition, lighting, style, and any motion or detail that matters for the output. Short one-liners are not acceptable unless the model explicitly favors them.
2. Generate exactly ${count} prompts. Vary approach (e.g. style, perspective, emphasis) so we explore different directions.
3. For each prompt you must also provide:
   - reasoning: 1–2 sentences on why this prompt is strong (e.g. clarity, specificity, alignment with guidelines).
   - tags: 3–6 short tags such as style, motion, lighting, composition, mood, subject (lowercase, English).
4. Output ONLY the prompt text. No parameters, no JSON keys — just the prompt string in the "prompt" field.

## Required JSON shape (return ONLY this, no markdown/code fences)
{
  "prompts": [
    {
      "prompt": "full scene-descriptive prompt in English",
      "reasoning": "why this prompt is effective",
      "tags": ["tag1", "tag2", "tag3"],
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
  const promptContext = formatPromptContext(modelSpec);
  const guidelinesText = formatGuidelines(modelSpec);
  const outputType = modelSpecOutputType(modelSpec);
  const outputFormat = outputType === 'image' || outputType === 'video' ? 'url[]' : 'string';

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

## Model context (prompt writing only — no params)
${modelSpec.summary ? `Summary: ${modelSpec.summary}\n` : ''}
Input: ${promptContext}

Prompt writing guidelines (follow strictly):
${guidelinesText}

Output: ${outputType}, format: ${outputFormat}

## Your job
1. EVOLVE the selected prompts: take what worked (clarity, structure, appeal) and produce new prompts that are clearly better or different—different angles, stronger scene description, better alignment with guidelines. The new prompts must feel like a clear evolution, not a copy-paste.
2. Keep prompts LONG and SCENE-DESCRIPTIVE. Add or refine detail (lighting, motion, style, composition) where it helps.
3. Generate exactly ${count} prompts. Vary them so we explore multiple directions.
4. For each prompt provide:
   - reasoning: 1–2 sentences on how this evolved from the selection and why it is stronger.
   - tags: 3–6 short tags (e.g. style, motion, lighting — lowercase, English).
5. Output ONLY the prompt text. Include inputAssets only when the model needs image/video input.

## Required JSON shape (return ONLY this, no markdown/code fences)
{
  "prompts": [
    {
      "prompt": "evolved, scene-descriptive prompt in English",
      "reasoning": "how this evolved and why it is better",
      "tags": ["tag1", "tag2", "tag3"],
      "inputAssets": {}
    }
  ]
}

Return ONLY the JSON object, no other text.`;
}
