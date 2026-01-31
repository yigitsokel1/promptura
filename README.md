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
- fal.ai for execution
- Gemini for reasoning
- PostgreSQL database as source of truth

## How Model Discovery Works

Models are discovered and validated through a multi-step process:

1. **Validation**: Users can validate fal.ai model endpoints via the Playground. The system checks if the endpoint exists in fal.ai's API.
2. **Research**: Once validated, a research job is automatically created. Gemini analyzes the model's metadata, documentation, and capabilities to generate a normalized `ModelSpec`.
3. **Normalization**: The `ModelSpec` includes:
   - Input parameters (name, type, required, min/max)
   - Output format (type, format)
   - Prompt guidelines
   - Recommended parameter ranges
   - Workflow steps (for workflows)
4. **Activation**: Once research is complete, the model status changes to `active` and becomes available in the Playground.

All model information is stored in the database, ensuring consistency and enabling spec-driven UI generation.

## How to Add a Model

Adding a new model to the catalog is straightforward:

### Via Playground

1. **Navigate to Playground**: Go to `/playground`
2. **Enter Endpoint ID**: In the "Add New Model" section, enter a fal.ai endpoint ID (e.g., `fal-ai/flux/dev`)
3. **Click "Add Model"**: The system will:
   - Validate the endpoint exists in fal.ai
   - Create a `ModelEndpoint` record with status `pending_research`
   - Automatically start a research job
   - Add the model to your catalog
4. **Wait for Research**: The model will show a "pending research" badge while Gemini analyzes it
5. **Automatic Activation**: Once research completes (typically 10-30 seconds), the model becomes `active` and ready to use

### Flow Details

```
User enters endpoint_id
    ↓
/api/models/validate (POST)
    ↓
fal.ai API: Model exists? → Yes/No
    ↓ (if Yes)
DB: Create ModelEndpoint (status: pending_research)
    ↓
DB: Create ResearchJob (status: queued)
    ↓
Background: /api/research/process (auto-triggered)
    ↓
Gemini: Analyze model → Generate ModelSpec
    ↓
DB: Save ModelSpec
    ↓
DB: Update ModelEndpoint (status: active)
    ↓
Model ready for use in Playground
```

### Error Handling

- **Invalid endpoint**: Returns 404 with clear error message
- **Model already exists**: Returns existing model info (no duplicate created)
- **Research fails**: Model remains in `pending_research` status; can be retried from Admin Panel

### Via Admin Panel

Admins can also trigger research refresh for existing models:
- Navigate to `/admin/models/[id]`
- Click "Start Research" to regenerate the model spec

## Why Gemini is Used for Research & Prompt Generation

Gemini serves two critical roles in the system:

### 1. Model Research
Fal.ai models have varying schemas, documentation quality, and parameter structures. Gemini analyzes model metadata to:
- Extract input/output specifications
- Generate prompt writing guidelines
- Identify recommended parameter ranges
- Understand workflow steps (for workflows)

This creates a normalized `ModelSpec` that enables spec-driven UI generation.

### 2. Prompt Generation (Fallback)
When the target model doesn't natively support prompt generation (e.g., fal.ai image models), Gemini acts as a paired reasoning engine:
- Generates candidate prompts based on the task goal
- Incorporates user feedback for refinement
- Ensures we always have a way to generate prompts regardless of model capabilities

**Why not use fal.ai's LLM directly?**
- Fal.ai focuses on execution (image/video generation), not reasoning
- Gemini provides superior reasoning capabilities for research and prompt generation
- Separation of concerns: fal.ai = execution, Gemini = reasoning

## Admin Panel Responsibilities

The admin panel (`/admin/models`) provides model management capabilities:

- **Model List**: View all models with their status (active, disabled, pending_research)
- **Model Details**: View model metadata, latest spec, and research job history
- **Status Management**: Update model status (active/disabled/pending_research)
- **Research Refresh**: Trigger new research jobs to regenerate model specs
  - Overwrites existing specs with fresh Gemini analysis
  - Useful when model documentation is updated or improved

**Important**: The admin panel never writes prompts. It only manages model metadata and research jobs. Prompt generation happens in the Playground based on user tasks.

## Prompt Generation Strategy (Model-First + Gemini Fallback)

The system uses a model-first approach with Gemini fallback for prompt generation. When generating candidate prompts, the system first checks if the target model natively supports prompt generation. If it does (e.g., Gemini models like `gemini-nano`, `gemini-1.5-pro`), the model generates prompts itself (`generator: 'self'`). If the target model doesn't support prompt generation (e.g., Fal.ai models), the system falls back to using Gemini as a prompt generator (`generator: 'gemini-fallback'`). This ensures we always have a way to generate prompts regardless of the target model's capabilities, while leveraging native prompt generation when available for better results.

## Status
Sprint 2 – Model discovery, research pipeline, spec-driven UI

