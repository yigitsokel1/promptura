/**
 * Gemini fallback provider adapter
 * Prompt generation uses Contract v2 (promptTemplates + structured prompts with reasoning/tags).
 * Also implements model research/analysis.
 */

import type {
  ProviderAdapter,
  PromptGenerationContext,
  PromptGenerationResult,
  RunCandidatesResult,
} from '../types';
import type { TaskSpec, ModelRef, CandidatePrompt } from '@/src/core/types';
import type { ResearchGuidelinesResult } from '@/src/core/modelSpec';
import { modelSpecNeedsImage, modelSpecNeedsVideo } from '@/src/core/modelSpec';
import type { FalAIModelMetadata } from '../falai/types';
import {
  generatePrompts,
  refinePrompts,
  type GeminiPromptsResponse,
} from '@/src/lib/gemini/promptTemplates';

export interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
}

export class GeminiAdapter implements ProviderAdapter {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com';
  }

  /**
   * Generate candidate prompts using Gemini with ModelSpec awareness.
   * Uses Contract v2: promptTemplates (generatePrompts / refinePrompts) + structured response with prompt, reasoning, tags.
   */
  async generateCandidates(
    task: TaskSpec,
    targetModel: ModelRef,
    count: number,
    context?: PromptGenerationContext
  ): Promise<PromptGenerationResult> {
    if (!context?.modelSpec) {
      throw new Error('ModelSpec is required for prompt generation');
    }

    const modelSpec = context.modelSpec;
    const isRefinement = Boolean(context.feedback?.length && context.selectedPrompts?.length);

    // Single place for prompts: promptTemplates (Contract v2)
    const promptText = isRefinement
      ? refinePrompts(task, modelSpec, context.selectedPrompts!, count)
      : generatePrompts(task, modelSpec, count);

    // Contract v2 schema: prompts[].{ prompt, reasoning, tags, inputAssets? } — no params; we use spec defaults
    const itemProperties: Record<string, unknown> = {
      prompt: { type: 'string', description: 'Main prompt text in English' },
      reasoning: { type: 'string', description: 'Why this prompt is effective' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags e.g. style, motion, lighting',
      },
    };
    const hasImageInput = modelSpecNeedsImage(modelSpec);
    const hasVideoInput = modelSpecNeedsVideo(modelSpec);
    if (hasImageInput || hasVideoInput) {
      const inputAssetsProperties: Record<string, { type: string }> = {};
      if (hasImageInput) inputAssetsProperties.image = { type: 'string' };
      if (hasVideoInput) inputAssetsProperties.video = { type: 'string' };
      itemProperties.inputAssets = {
        type: 'object',
        properties: inputAssetsProperties,
      };
    }

    const jsonSchema = {
      type: 'object',
      properties: {
        prompts: {
          type: 'array',
          items: {
            type: 'object',
            properties: itemProperties,
            required: ['prompt', 'reasoning', 'tags'],
          },
        },
      },
      required: ['prompts'],
    };

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const url = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const requestBody = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: isRefinement ? 0.7 : 0.9,
        responseMimeType: 'application/json',
        responseSchema: jsonSchema,
      },
    };

    const geminiRequestId = `gemini_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[Gemini] requestId=${geminiRequestId} ${isRefinement ? 'refine' : 'generate'} count=${count}`);

    try {
      const timeoutMs = Math.max(
        60_000,
        parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? '300000', 10) || 300000
      );
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[Gemini] requestId=${geminiRequestId} response error ${response.status}`);
        throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      let result: GeminiPromptsResponse;

      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        let jsonText = data.candidates[0].content.parts[0].text.trim();
        if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        else if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        result = JSON.parse(jsonText);
      } else if (data.candidates?.[0]?.content?.parts?.[0]?.json) {
        result = data.candidates[0].content.parts[0].json as GeminiPromptsResponse;
      } else {
        throw new Error('No JSON response from Gemini');
      }

      if (!result.prompts || !Array.isArray(result.prompts)) {
        throw new Error('Gemini response missing prompts array');
      }

      console.log(`[Gemini] requestId=${geminiRequestId} response ok prompts=${result.prompts.length}`);

      const candidates: CandidatePrompt[] = result.prompts.slice(0, count).map((item, index) => ({
        id: `gemini_candidate_${Date.now()}_${index}`,
        prompt: item.prompt,
        inputAssets: item.inputAssets ? (item.inputAssets as CandidatePrompt['inputAssets']) : undefined,
        generator: 'gemini-fallback',
        reasoning: item.reasoning,
        tags: Array.isArray(item.tags) ? item.tags : undefined,
      }));

      return { candidates };
    } catch (error) {
      console.log(`[Gemini] requestId=${geminiRequestId} threw`, error instanceof Error ? error.message : String(error));
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
      const isTimeout =
        (error instanceof Error && error.name === 'AbortError') ||
        /timeout|Timeout/i.test(message) ||
        (cause != null && /timeout|Timeout/i.test(cause));
      const hint = isTimeout
        ? ' Gemini was slow to respond. Increase GEMINI_REQUEST_TIMEOUT_MS (default 300000ms) or retry.'
        : message === 'fetch failed'
          ? ' Check network, GEMINI_API_KEY in .env, and that https://generativelanguage.googleapis.com is reachable.'
          : '';
      throw new Error(
        `Failed to generate candidates with Gemini: ${message}${cause ? ` (${cause})` : ''}${hint}`
      );
    }
  }

  /**
   * Run candidate prompts
   * @deprecated Gemini is used for reasoning/research, not execution.
   * Execution should be done via fal.ai or other execution providers.
   * This method exists to satisfy ProviderAdapter interface but should not be called.
   */
  async runCandidates(
    _task: TaskSpec,
    _targetModel: ModelRef,
    _candidates: CandidatePrompt[]
  ): Promise<RunCandidatesResult> {
    throw new Error(
      'Gemini adapter does not support running candidates. Use fal.ai or other execution providers.'
    );
  }

  /**
   * Research prompt guidelines only (Sprint 7 — no params, no modality/required_assets).
   * Modality and required_assets come from schema or endpoint; Gemini never guesses them.
   */
  async researchModel(
    modelMetadata: FalAIModelMetadata,
    kind: 'model' | 'workflow',
    modality: string
  ): Promise<ResearchGuidelinesResult> {
    const prompt = this.buildResearchPrompt(modelMetadata, kind, modality);

    const url = `${this.baseUrl}/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    };

    try {
      const timeoutMs = Math.max(60_000, parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? '300000', 10) || 300000);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      let result: ResearchGuidelinesResult;

      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        let jsonText = data.candidates[0].content.parts[0].text.trim();
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        result = JSON.parse(jsonText);
      } else if (data.candidates?.[0]?.content?.parts?.[0]?.json) {
        result = data.candidates[0].content.parts[0].json as ResearchGuidelinesResult;
      } else {
        const textPart = data.candidates?.[0]?.content?.parts?.find(
          (part: { text?: string }) => part.text
        );
        if (textPart?.text) {
          result = JSON.parse(textPart.text);
        } else {
          throw new Error('No JSON response from Gemini');
        }
      }

      this.validateResearchGuidelines(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
      const hint = message === 'fetch failed'
        ? ' Check network, GEMINI_API_KEY in .env, and that https://generativelanguage.googleapis.com is reachable.'
        : '';
      throw new Error(
        `Failed to research model with Gemini: ${message}${cause ? ` (${cause})` : ''}${hint}`
      );
    }
  }

  /**
   * Build the research prompt — guidelines only. We already have modality from schema/API.
   */
  private buildResearchPrompt(
    modelMetadata: FalAIModelMetadata,
    kind: 'model' | 'workflow',
    modality: string
  ): string {
    const metadata = modelMetadata.metadata;
    const endpointId = modelMetadata.endpoint_id;

    return `You are an AI model researcher. Your job is ONLY to write prompt guidelines and an optional summary. Do NOT guess modality, required_assets, or any API parameters — we get those from the API/schema.

Model information (for context only):
- Endpoint ID: ${endpointId}
- Kind: ${kind}
- Modality (we already know this): ${modality}
- Display Name: ${metadata.display_name || 'N/A'}
- Category: ${metadata.category || 'N/A'}
- Description: ${metadata.description || 'N/A'}

Your task:
1. Write prompt_guidelines: 3–8 actionable tips for how to write effective prompts for this model and for this modality (e.g. for text-to-image: style, composition, lighting; for image-to-video: motion, timing).
2. Optionally write summary: one or two sentences on how this model works or what it is best at.

Return ONLY a valid JSON object with this exact structure:
{
  "prompt_guidelines": ["guideline 1", "guideline 2", "..."],
  "summary": "Optional brief explanation"
}

Important:
- Do NOT include modality, required_assets, inputs, outputs, or any parameter definitions.
- Focus only on how to write good prompts for this modality and model.

Return ONLY the JSON, no markdown, no code blocks, no explanations.`;
  }

  /** Validate research result (guidelines only). */
  private validateResearchGuidelines(result: ResearchGuidelinesResult): void {
    if (!result.prompt_guidelines || !Array.isArray(result.prompt_guidelines)) {
      throw new Error('Research result must have prompt_guidelines array');
    }
    if (result.prompt_guidelines.length === 0) {
      throw new Error('prompt_guidelines must have at least one item');
    }
  }
}

/**
 * Create Gemini adapter from environment variables
 */
export function createGeminiAdapter(): GeminiAdapter {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  return new GeminiAdapter({
    apiKey,
    baseUrl: process.env.GEMINI_BASE_URL,
  });
}
