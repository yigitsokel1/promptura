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
import type { ModelSpec } from '@/src/core/modelSpec';
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

    // Contract v2 schema: prompts[].{ prompt, reasoning, tags, params?, inputAssets? }
    const paramsProperties: Record<string, { type: string; description?: string; enum?: string[] }> = {};
    modelSpec.inputs.forEach((input) => {
      if (
        input.name.toLowerCase() === 'prompt' ||
        input.type.toLowerCase() === 'image' ||
        input.type.toLowerCase() === 'video'
      ) {
        return;
      }
      let schemaType = 'string';
      if (input.type === 'number') schemaType = 'number';
      else if (input.type === 'boolean') schemaType = 'boolean';
      const prop: { type: string; description?: string; enum?: string[] } = {
        type: schemaType,
        description: input.description || `${input.name} parameter`,
      };
      if (schemaType === 'string' && input.enum?.length) prop.enum = input.enum;
      paramsProperties[input.name] = prop;
    });

    const itemProperties: Record<string, unknown> = {
      prompt: { type: 'string', description: 'Main prompt text in English' },
      reasoning: { type: 'string', description: 'Why this prompt is effective' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags e.g. style, motion, lighting',
      },
    };
    if (Object.keys(paramsProperties).length > 0) {
      itemProperties.params = {
        type: 'object',
        description: 'Model-specific parameters',
        properties: paramsProperties,
      };
    }
    const hasImageInput = modelSpec.inputs.some((inp) => inp.type.toLowerCase() === 'image');
    const hasVideoInput = modelSpec.inputs.some((inp) => inp.type.toLowerCase() === 'video');
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

    const url = `${this.baseUrl}/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`;
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
        params: item.params ? (item.params as CandidatePrompt['params']) : undefined,
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
   * Research and analyze a model to generate ModelSpec
   * This is the core research functionality that uses Gemini to understand a model
   */
  async researchModel(
    modelMetadata: FalAIModelMetadata,
    kind: 'model' | 'workflow',
    modality: string
  ): Promise<ModelSpec> {
    // Build the prompt for Gemini
    const prompt = this.buildResearchPrompt(modelMetadata, kind, modality);

    // Call Gemini API with JSON response mode
    // Using Gemini 3 Flash Preview - latest model (December 2025)
    const url = `${this.baseUrl}/v1beta/models/gemini-3-flash-preview:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gemini API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      // Extract JSON from response
      // When responseMimeType is 'application/json', the response structure may vary
      let spec: ModelSpec;
      
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        // Text response (might be wrapped in code blocks)
        let jsonText = data.candidates[0].content.parts[0].text.trim();
        
        // Remove code blocks if present
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        spec = JSON.parse(jsonText);
      } else if (data.candidates?.[0]?.content?.parts?.[0]?.json) {
        // Direct JSON response (when using responseMimeType)
        spec = data.candidates[0].content.parts[0].json as ModelSpec;
      } else {
        // Fallback: try to parse the entire response or look for text in parts
        const textPart = data.candidates?.[0]?.content?.parts?.find(
          (part: { text?: string }) => part.text
        );
        if (textPart?.text) {
          spec = JSON.parse(textPart.text);
        } else {
          throw new Error('No JSON response from Gemini');
        }
      }

      // Validate the spec structure
      this.validateModelSpec(spec);

      return spec;
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
   * Build the research prompt for Gemini
   */
  private buildResearchPrompt(
    modelMetadata: FalAIModelMetadata,
    kind: 'model' | 'workflow',
    modality: string
  ): string {
    const metadata = modelMetadata.metadata;
    const endpointId = modelMetadata.endpoint_id;

    return `You are an AI model researcher. Analyze the following fal.ai model endpoint and generate a comprehensive JSON specification.

Model Information:
- Endpoint ID: ${endpointId}
- Kind: ${kind}
- Modality: ${modality}
- Display Name: ${metadata.display_name || 'N/A'}
- Category: ${metadata.category || 'N/A'}
- Description: ${metadata.description || 'N/A'}
- Status: ${metadata.status || 'N/A'}
- Tags: ${metadata.tags?.join(', ') || 'N/A'}

Your task:
1. Analyze the model's capabilities based on the metadata
2. Determine the input parameters (name, type, required, min/max if applicable)
3. Determine the output format (type, format)
4. Provide recommended parameter ranges if applicable
5. Generate prompt writing guidelines based on the model's purpose
6. If this is a workflow, identify the workflow steps

Return ONLY a valid JSON object with this exact structure:
{
  "inputs": [
    { "name": "param_name", "type": "string|number|boolean|image", "required": true/false, "min": number (optional), "max": number (optional), "description": "string (optional)", "enum": ["value1", "value2"] (optional - ONLY for string params with a fixed set of allowed values, e.g. image_size) }
  ],
  "outputs": {
    "type": "text|image|video|audio",
    "format": "string|url|url[]|base64",
    "description": "string (optional)"
  },
  "recommended_ranges": {
    "param_name": [min, max]
  },
  "prompt_guidelines": [
    "guideline 1",
    "guideline 2"
  ],
  "workflow_steps": [
    { "step": 1, "description": "...", "inputs": ["..."], "outputs": ["..."] }
  ],
  "summary": "Brief explanation of how this model works"
}

Important:
- Be specific and accurate based on the model metadata
- For image models, typically have "prompt" (string, required) and "steps" (number, 1-50)
- For string parameters that accept only specific values (e.g. image_size, aspect_ratio), include an "enum" array with the exact allowed values from the API (e.g. "enum": ["square_hd", "square", "portrait_4_3", "landscape_4_3"])
- For text models, typically have "prompt" (string, required)
- Output format should match the modality (image models output "image" type with "url[]" format)
- Prompt guidelines should be actionable and specific to this model
- If workflow_steps is not applicable, use an empty array
- recommended_ranges is optional but helpful for numeric parameters

Return ONLY the JSON, no markdown, no code blocks, no explanations.`;
  }

  /**
   * Validate the ModelSpec structure
   */
  private validateModelSpec(spec: ModelSpec): void {
    if (!spec.inputs || !Array.isArray(spec.inputs)) {
      throw new Error('ModelSpec must have inputs array');
    }
    if (!spec.outputs || typeof spec.outputs !== 'object') {
      throw new Error('ModelSpec must have outputs object');
    }
    if (!spec.prompt_guidelines || !Array.isArray(spec.prompt_guidelines)) {
      throw new Error('ModelSpec must have prompt_guidelines array');
    }
    if (spec.inputs.length === 0) {
      throw new Error('ModelSpec must have at least one input');
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
