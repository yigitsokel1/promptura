# Promptura

A playground to iteratively discover the best prompt for a task.

---

## How Promptura works (Iteration Loop)

Promptura has **one flow**: task-based iteration. You describe what you want; the system generates and runs candidate prompts, then lets you refine from the best ones.

### The loop (high level)

1. **You set the task**  
   Pick a model, write a **task goal** (e.g. “a cat in a hat, watercolor style”), and hit **Generate**. You never type a raw prompt.

2. **System generates many candidates**  
   Gemini creates **20 candidate prompts** from your goal and the model’s spec (guidelines, required assets). Each candidate is sent to the model (e.g. fal.ai); the UI polls until all runs finish.

3. **You choose what worked**  
   You see prompts + outputs. You **select** the ones you like and optionally add **notes** (e.g. “lighter background”).

4. **You refine**  
   Click **Refine**. Gemini gets your task, the model spec, the **selected prompts**, **your notes**, and short **summaries of the run outputs**. It produces **10 new prompts** that build on what worked. Those 10 are run again; the cycle repeats.

So: **Task → Generate (20) → Select + note → Refine (10) → …**  
There is no “manual mode”: no typing a single prompt and running it once. The product is this loop.

### Why it works

- **Task-based** keeps you at the intent level; the system handles prompt wording and model parameters.
- **Generate → select → refine** uses the model’s actual outputs and your feedback, so each round is informed by real results.
- **Gemini** is the single prompt creator: it sees the ModelSpec (modality, required assets, prompt guidelines) and, on refine, the selected prompts, notes, and output summaries, so prompts stay consistent and on-spec.

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
- Provider-agnostic core domain; multi-provider execution (fal.ai, EachLabs) via `ExecutionProvider` abstraction
- Gemini for prompt generation and model research (centralized key; see ADR-005)
- User API keys for execution providers (fal.ai, EachLabs), encrypted at rest
- PostgreSQL as source of truth (users, model endpoints, iterations, runs)

## Authentication

- **Login**: Google OAuth via NextAuth v5. Configure `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` (see `.env.example`).
- **Protected routes**:
  - **Login required**: `/playground`, `/settings` — redirect to `/login` if not signed in.
  - **ADMIN only**: `/admin/*` — requires `users.role = 'ADMIN'` in the database (no hardcoded tokens).
- **Role from DB**: The `users.role` column (`ADMIN` | `USER`) is the single source of truth. JWT session is updated on sign-in from DB.
- **First admin**: After signing in once with Google, set role in the database, e.g.  
  `node scripts/set-admin.js your@email.com` or `UPDATE users SET role = 'ADMIN' WHERE email = 'your@email.com';`  
  Then sign out and sign in again so the session picks up the new role.
- **API routes**: All iteration, playground, and settings APIs check auth (e.g. `requireAuth()` or `requireAdmin()`). Status polling uses the iteration’s `userId` to resolve the correct user API key.

## User API Keys

- **Per-user keys for execution**: fal.ai and EachLabs API keys are **stored per user**, not shared. Users set them in **Settings → Provider keys**. Keys are never returned to the client or logged.
- **Encryption**: Keys are encrypted at rest (AES-256-GCM) using `PROVIDER_KEY_ENCRYPTION_SECRET`. Plaintext exists only in memory when needed for a request.
- **Where keys are used**: Generate and Refine call `requireUserProviderKey(userId, provider)` to get the key, then pass it to the execution provider. Status polling uses the iteration’s `userId` to load the same key for fal.ai/EachLabs job status.
- **Missing key**: If the user has not set a key for the chosen provider, the API returns `400` with `code: 'MissingProviderKey'` and a clear message to add the key in Settings.
- **Gemini**: Prompt generation uses a **centralized** Gemini API key (server env). Rationale: [ADR-005: Why Gemini key is centralized](docs/adr/ADR-005-gemini-key-centralized.md).

## Multi-provider architecture

- **Execution providers**: The app supports multiple backends for **running** prompts (e.g. fal.ai, EachLabs). Each is implemented as an `ExecutionProvider` (submit → status → result). The runtime picks the provider via `modelEndpoint.provider` and a factory; there are no `if (provider === …)` branches in call sites.
- **Prompt generation**: Prompt **authoring** is done by a single service (Gemini). It consumes the same ModelSpec and task context for all execution providers.
- **Model catalog**: Each model has a `provider` field (`falai` | `eachlabs`) and an `endpointId` (provider-specific, e.g. fal.ai path or EachLabs slug). Admin adds/validates models; research produces a unified ModelSpec so the Playground works the same regardless of provider.
- **Adding a provider**: Implement `ExecutionProvider` (payload build, submit, status, result, output conversion), register in the factory, and add `provider` + `endpointId` for models in the catalog. See `src/providers/execution/`.

## How Model Discovery Works

Models are discovered and validated through a multi-step process:

1. **Validation**: Users can validate fal.ai model endpoints via the Playground. The system checks if the endpoint exists in fal.ai's API.
2. **Research**: Once validated, a research job is automatically created. Gemini analyzes the model's metadata, documentation, and capabilities to generate a normalized `ModelSpec`.
3. **Normalization**: The `ModelSpec` is param-free and includes:
   - **modality**: e.g. text-to-image, image-to-video, text-to-video
   - **required_assets**: none | image | video | image+video
   - **prompt_guidelines**: actionable tips for prompt writing
   - **summary** (optional): how the model works
4. **Activation**: Once research is complete, the model status changes to `active` and becomes available in the Playground.

All model information is stored in the database, ensuring consistency and enabling spec-driven UI. For why ModelSpec and execution have no parameters, see **[ADR-008: Param-Free ModelSpec](docs/adr/ADR-008-param-free-model-spec.md)**.

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
User enters endpoint_id (fal.ai or EachLabs)
    ↓
/api/models/validate (POST)
    ↓
Provider API: Model exists? → Yes/No
    ↓ (if Yes)
DB: Create ModelEndpoint (status: pending_research)
    ↓
DB: Create ResearchJob (status: queued)
    ↓
Background: runResearchJob (auto-triggered)
    ↓
Research (Sprint 7 — param-free):
  - Modality + required_assets derived from provider metadata (no schema parsing).
  - Gemini produces only prompt_guidelines + summary (never params or asset requirements).
    ↓
DB: Save ModelSpec
    ↓
DB: Update ModelEndpoint (status: active)
    ↓
Model ready for use in Playground
```

### Reset models (fresh start)

To clear all models and start over:

```bash
npm run db:reset-models
```

Then re-add models via Playground or Admin. Recommended endpoints:

| Provider | Modality | Endpoint ID |
|----------|----------|-------------|
| fal.ai | text-to-image | `fal-ai/flux/dev` |
| fal.ai | image-to-image | `fal-ai/flux/dev/image-to-image` |
| fal.ai | text-to-video | `fal-ai/minimax-video-01` |
| eachlabs | image-to-video | `nano-banana-pro-edit` |

### Error Handling

- **Invalid endpoint**: Returns 404 with clear error message
- **Model already exists**: Returns existing model info (no duplicate created)
- **Research fails**: Model remains in `pending_research` status; can be retried from Admin Panel

### Via Admin Panel

Admins can also trigger research refresh for existing models:
- Navigate to `/admin/models/[id]`
- Click "Start Research" to regenerate the model spec

## Why prompts are generated by Gemini

**All candidate prompts (generate and refine) are created by Gemini.** The execution model (e.g. fal.ai) only runs those prompts; it does not author them. For why the **Gemini API key is server-side (centralized)** rather than per-user, see **[ADR-005: Why Gemini key is centralized](docs/adr/ADR-005-gemini-key-centralized.md)**.

### Why Gemini is the single prompt creator

- **One reasoning engine**: Same system that researches models (and produces ModelSpec) also writes prompts. It sees the same modality, required assets, and guidelines, so prompts stay aligned with the spec. Execution uses minimal payload (prompt + assets only); no param forms in UI.
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
- **Delete model**: Remove an endpoint from the catalog; related specs, research jobs, and runs are removed via database cascade

**Important**: The admin panel never writes prompts. It only manages model metadata and research jobs. Prompt generation happens in the Playground based on user tasks.

## Status
Sprint 4 – Stabilization, quality, observability. Iteration loop and Gemini-as-prompter are fixed (see ADR-003, ADR-004).

