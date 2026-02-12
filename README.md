# Promptura

A playground to iteratively discover the best prompt for a task.

---

## How PromptAura works (Iteration Loop)

PromptAura has **one flow**: task-based iteration. You describe what you want; the system generates and runs candidate prompts, then lets you refine from the best ones.

### The loop (high level)

1. **You set the task**  
   Pick a model, write a **task goal** (e.g. “a cat in a hat, watercolor style”), and hit **Generate**. You never type a raw prompt.

2. **System generates many candidates**  
   Gemini creates **20 candidate prompts** from your goal and the model’s spec (guidelines, parameters). Each candidate is sent to the model (e.g. fal.ai); the UI polls until all runs finish.

3. **You choose what worked**  
   You see prompts + outputs. You **select** the ones you like and optionally add **notes** (e.g. “lighter background”).

4. **You refine**  
   Click **Refine**. Gemini gets your task, the model spec, the **selected prompts**, **your notes**, and short **summaries of the run outputs**. It produces **10 new prompts** that build on what worked. Those 10 are run again; the cycle repeats.

So: **Task → Generate (20) → Select + note → Refine (10) → …**  
There is no “manual mode”: no typing a single prompt and running it once. The product is this loop.

### Why it works

- **Task-based** keeps you at the intent level; the system handles prompt wording and model parameters.
- **Generate → select → refine** uses the model’s actual outputs and your feedback, so each round is informed by real results.
- **Gemini** is the single prompt creator: it sees the ModelSpec (guidelines, inputs/outputs) and, on refine, the selected prompts, notes, and output summaries, so prompts stay consistent and on-spec.

### Where things live

- **Playground** (`/playground`): the only place you run the loop (task, generate, results, select, refine).
- **Admin** (`/admin/models`, `/admin/iterations`): add/validate models, trigger research, inspect iterations and run status. No prompt editing.
- **APIs**: `POST /api/iterations/generate`, `POST /api/iterations/refine`, `GET /api/iterations/[id]/status` drive the loop; the UI polls status until all runs are done.

For the design rationale (why task-based, why no manual mode, why Gemini is the single prompt creator), see **[ADR-004: Iteration and Refine Design](docs/adr/ADR-004-iteration-and-refine-design.md)**.

---

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

## Why prompts are generated by Gemini

**All candidate prompts (generate and refine) are created by Gemini.** The execution model (e.g. fal.ai) only runs those prompts; it does not author them.

### Why Gemini is the single prompt creator

- **One reasoning engine**: Same system that researches models (and produces ModelSpec) also writes prompts. It sees the same guidelines, inputs/outputs, and parameter ranges, so prompts stay aligned with the spec.
- **Task → prompts**: You give a task goal; Gemini turns it into many concrete prompts (and, on refine, into better ones using your selections and output summaries). You never have to guess prompt wording or model-specific parameters.
- **Refine quality**: Refine sends Gemini the selected prompts, your notes, and short summaries of what the model actually produced. That context is why refined prompts “evolve” instead of feeling random.
- **Execution vs reasoning**: fal.ai (and similar) are built for running jobs (image/video generation, etc.), not for structured prompt authoring. Gemini handles authoring; the execution provider only runs the prompts we give it.

## Admin Panel Responsibilities

The admin panel (`/admin/models`) provides model management capabilities:

- **Model List**: View all models with their status (active, disabled, pending_research)
- **Model Details**: View model metadata, latest spec, and research job history
- **Status Management**: Update model status (active/disabled/pending_research)
- **Research Refresh**: Trigger new research jobs to regenerate model specs
  - Overwrites existing specs with fresh Gemini analysis
  - Useful when model documentation is updated or improved

**Important**: The admin panel never writes prompts. It only manages model metadata and research jobs. Prompt generation happens in the Playground based on user tasks.

## Status
Sprint 4 – Stabilization, quality, observability. Iteration loop and Gemini-as-prompter are fixed (see ADR-003, ADR-004).

