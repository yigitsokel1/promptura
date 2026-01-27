# PromptAura


A playground to iteratively discover the best prompt for a task.

## Core Idea
1. Generate multiple candidate prompts
2. Run each prompt to produce results
3. Select best prompt-result pairs with notes
4. Refine and repeat

## Architecture
- Next.js (App Router)
- Provider-agnostic core domain
- fal.ai

## Prompt Generation Strategy (Model-First + Gemini Fallback)

The system uses a model-first approach with Gemini fallback for prompt generation. When generating candidate prompts, the system first checks if the target model natively supports prompt generation. If it does (e.g., Gemini models like `gemini-nano`, `gemini-1.5-pro`), the model generates prompts itself (`generator: 'self'`). If the target model doesn't support prompt generation (e.g., Fal.ai models), the system falls back to using Gemini as a prompt generator (`generator: 'gemini-fallback'`). This ensures we always have a way to generate prompts regardless of the target model's capabilities, while leveraging native prompt generation when available for better results.

## Status
Sprint 1 – Core iteration loop

