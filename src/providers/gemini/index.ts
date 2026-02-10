/**
 * Gemini fallback provider adapter
 * Currently only implements PromptGen (for fallback prompt generation)
 * Also implements model research/analysis
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
   * Generate candidate prompts using Gemini with ModelSpec awareness
   * Uses structured output (JSON schema) to ensure type safety
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
    const isRefinement = context.feedback && context.feedback.length > 0;

    // Build prompt for Gemini
    const prompt = this.buildPromptGenerationPrompt(
      task,
      modelSpec,
      count,
      Boolean(isRefinement),
      context.feedback
    );

    // Define JSON schema for structured output
    // Note: Gemini API requires properties to be non-empty for object types
    // We build params properties from ModelSpec inputs (excluding prompt and media inputs)
    const paramsProperties: Record<string, { type: string; description?: string }> = {};
    modelSpec.inputs.forEach((input) => {
      // Skip prompt and media inputs (they're handled separately)
      if (input.name.toLowerCase() === 'prompt' || 
          input.type.toLowerCase() === 'image' || 
          input.type.toLowerCase() === 'video') {
        return;
      }
      
      // Map input types to JSON schema types
      let schemaType = 'string';
      if (input.type === 'number') {
        schemaType = 'number';
      } else if (input.type === 'boolean') {
        schemaType = 'boolean';
      }
      
      paramsProperties[input.name] = {
        type: schemaType,
        description: input.description || `${input.name} parameter`,
      };
    });

    // Build the schema
    const candidateProperties: Record<string, unknown> = {
      prompt: {
        type: 'string',
        description: 'The main prompt text (must be in English)',
      },
    };

    // Only include params if there are parameter inputs
    if (Object.keys(paramsProperties).length > 0) {
      candidateProperties.params = {
        type: 'object',
        description: 'Model-specific parameters (steps, cfg, seed, etc.)',
        properties: paramsProperties,
      };
    }

    // Only include inputAssets if there are image/video inputs
    const hasImageInput = modelSpec.inputs.some((inp) => inp.type.toLowerCase() === 'image');
    const hasVideoInput = modelSpec.inputs.some((inp) => inp.type.toLowerCase() === 'video');
    
    if (hasImageInput || hasVideoInput) {
      const inputAssetsProperties: Record<string, { type: string }> = {};
      if (hasImageInput) {
        inputAssetsProperties.image = { type: 'string' };
      }
      if (hasVideoInput) {
        inputAssetsProperties.video = { type: 'string' };
      }
      
      candidateProperties.inputAssets = {
        type: 'object',
        description: 'Input media assets if needed (image, video, etc.)',
        properties: inputAssetsProperties,
      };
    }

    const jsonSchema = {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: candidateProperties,
            required: ['prompt'],
          },
        },
      },
      required: ['candidates'],
    };

    // Call Gemini API with structured output
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
        temperature: isRefinement ? 0.7 : 0.9, // Higher temperature for initial generation
        responseMimeType: 'application/json',
        responseSchema: jsonSchema,
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
      let result: { candidates: Array<{ prompt: string; params?: unknown; inputAssets?: unknown }> };
      
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        // Text response (might be wrapped in code blocks)
        let jsonText = data.candidates[0].content.parts[0].text.trim();
        
        // Remove code blocks if present
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        result = JSON.parse(jsonText);
      } else if (data.candidates?.[0]?.content?.parts?.[0]?.json) {
        // Direct JSON response (when using responseSchema)
        result = data.candidates[0].content.parts[0].json as typeof result;
      } else {
        throw new Error('No JSON response from Gemini');
      }

      // Convert to CandidatePrompt format
      const candidates: CandidatePrompt[] = result.candidates.slice(0, count).map((candidate, index) => ({
        id: `gemini_candidate_${Date.now()}_${index}`,
        prompt: candidate.prompt,
        // params and inputAssets are optional - only include if present
        params: candidate.params ? (candidate.params as CandidatePrompt['params']) : undefined,
        inputAssets: candidate.inputAssets ? (candidate.inputAssets as CandidatePrompt['inputAssets']) : undefined,
        generator: 'gemini-fallback',
      }));

      return { candidates };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
      const isTimeout = error instanceof Error && error.name === 'AbortError' || /timeout|Timeout/i.test(message) || (cause && /timeout|Timeout/i.test(cause));
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
    { "name": "param_name", "type": "string|number|boolean|image", "required": true/false, "min": number (optional), "max": number (optional), "description": "string (optional)" }
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
- For text models, typically have "prompt" (string, required)
- Output format should match the modality (image models output "image" type with "url[]" format)
- Prompt guidelines should be actionable and specific to this model
- If workflow_steps is not applicable, use an empty array
- recommended_ranges is optional but helpful for numeric parameters

Return ONLY the JSON, no markdown, no code blocks, no explanations.`;
  }

  /**
   * Build the prompt generation prompt for Gemini
   * Uses ModelSpec to generate ModelSpec-aware prompts
   */
  private buildPromptGenerationPrompt(
    task: TaskSpec,
    modelSpec: ModelSpec,
    count: number,
    isRefinement: boolean,
    feedback?: Array<{
      candidateId: string;
      note?: string;
      selected: boolean;
    }>
  ): string {
    const inputsDescription = modelSpec.inputs
      .map((input) => {
        let desc = `- ${input.name} (${input.type}${input.required ? ', required' : ', optional'})`;
        if (input.min !== undefined || input.max !== undefined) {
          desc += ` [range: ${input.min ?? 'any'} to ${input.max ?? 'any'}]`;
        }
        if (input.description) {
          desc += `: ${input.description}`;
        }
        return desc;
      })
      .join('\n');

    const recommendedRangesText = modelSpec.recommended_ranges
      ? Object.entries(modelSpec.recommended_ranges)
          .map(([param, [min, max]]) => `- ${param}: ${min} to ${max}`)
          .join('\n')
      : 'None specified';

    const _taskGoalText = isRefinement && feedback
      ? `Previous iteration feedback:\n${feedback
          .filter((f) => f.selected)
          .map((f) => `- Selected candidate: ${f.note || 'No note'}`)
          .join('\n')}\n\nTask goal: ${task.goal}`
      : `Task goal: ${task.goal}`;

    const guidelinesText = modelSpec.prompt_guidelines
      .map((guideline, i) => `${i + 1}. ${guideline}`)
      .join('\n');

    const outputType = modelSpec.outputs.type;
    const outputFormat = modelSpec.outputs.format;

    let feedbackContext = '';
    if (isRefinement && feedback) {
      const selectedFeedback = feedback.filter((f) => f.selected);
      const selectedPrompts = selectedFeedback
        .map((f) => {
          const note = f.note ? ` (Note: ${f.note})` : '';
          return `- Selected candidate ${f.candidateId}${note}`;
        })
        .join('\n');
      feedbackContext = `\n\nPrevious Iteration Feedback:\nYou should refine and improve based on these selected candidates:\n${selectedPrompts}\n\nGenerate ${count} refined prompts that build upon the successful patterns from the selected candidates.`;
    }

    return `You are an expert prompt engineer. Generate ${count} diverse and effective candidate prompts for the following task.

Task Goal: ${task.goal}
Task Modality: ${task.modality}

CRITICAL: All prompts must be written in English, regardless of the language used in the task goal. If the task goal is in another language, translate the intent to English and generate English prompts.

Model Specifications:
${modelSpec.summary ? `Model Summary: ${modelSpec.summary}\n` : ''}
Model Inputs:
${inputsDescription}

Recommended Parameter Ranges:
${recommendedRangesText}

Prompt Writing Guidelines:
${guidelinesText}

Model Output:
- Type: ${outputType}
- Format: ${outputFormat}
${modelSpec.outputs.description ? `- Description: ${modelSpec.outputs.description}` : ''}
${feedbackContext}

Your task:
1. Generate ${count} diverse candidate prompts that align with the task goal
2. Each prompt must be written in English (translate the task goal's intent to English if needed)
3. Each prompt should follow the prompt writing guidelines
4. For each candidate, include:
   - prompt: The main prompt text (string, required, MUST BE IN ENGLISH)
   - params: Model-specific parameters (object, optional) - use recommended_ranges when applicable
   - inputAssets: Input media assets if needed (object, optional) - only if the model requires input images/videos

Important:
- ALL PROMPTS MUST BE IN ENGLISH - translate the task goal's intent if it's in another language
- Prompts should be creative, specific, and aligned with the model's capabilities
- Use recommended_ranges for numeric parameters (e.g., steps, cfg_scale)
- For string parameters with specific allowed values (e.g., image_size), ONLY use the exact values specified in the input description
- NEVER invent new values for string parameters - if a parameter has specific allowed values listed, you MUST use only those values
- For ${outputType} outputs, ensure prompts are optimized for that output type
- Vary the prompts significantly to explore different approaches
- Follow all prompt_guidelines strictly
${isRefinement ? '- Build upon successful patterns from the selected candidates' : ''}

Return a JSON object with this structure:
{
  "candidates": [
    {
      "prompt": "the prompt text",
      "params": { "steps": 30, "cfg_scale": 7.5 },
      "inputAssets": { "image": "url or base64 if needed" }
    }
  ]
}

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
