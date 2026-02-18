# Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                         User Interface                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Playground  │  │ Admin Panel  │  │  API Routes  │     │
│  │ (Spec-driven)│  │ (Management) │  │              │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
└─────────┼──────────────────┼──────────────────┼────────────┘
          │                  │                  │
          │                  │                  │
┌─────────▼──────────────────▼──────────────────▼────────────┐
│                    Core Domain Logic                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Types      │  │  Iteration  │  │  ModelSpec  │     │
│  │              │  │   Logic     │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────┬──────────────────┬──────────────────┬────────────┘
          │                  │                  │
          │                  │                  │
┌─────────▼──────────────────▼──────────────────▼────────────┐
│                    Provider Adapters                        │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │   Fal.ai     │  │   Gemini     │                        │
│  │ (Execution)  │  │ (Reasoning)  │                        │
│  └──────┬───────┘  └──────┬───────┘                        │
└─────────┼──────────────────┼───────────────────────────────┘
          │                  │
          │                  │
┌─────────▼──────────────────▼───────────────────────────────┐
│                    External Services                        │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │   fal.ai     │  │   Gemini     │                        │
│  │   API        │  │   API        │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Database (PostgreSQL)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ModelEndpoint │  │  ModelSpec   │  │ResearchJob   │     │
│  │              │  │              │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         ▲                  ▲                  ▲            │
│         └──────────────────┴──────────────────┘             │
│                    Source of Truth                          │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### fal.ai = Execution
- **Purpose**: Execute model runs (image/video generation, text processing)
- **When used**: 
  - Running candidate prompts to produce outputs
  - Validating model endpoints exist
  - Fetching model metadata
- **Not used for**: Reasoning, prompt generation, research

### Gemini = Reasoning
- **Purpose**: Provide reasoning capabilities
- **When used**:
  - Researching models to generate normalized specs
  - Generating candidate prompts (fallback when target model can't)
  - Refining prompts based on feedback
- **Not used for**: Execution of final model runs

### DB = Source of Truth
- **Purpose**: Store all model information and specs
- **Contains**:
  - `ModelEndpoint`: Model metadata (endpointId, kind, modality, status)
  - `ModelSpec`: Param-free spec JSON (modality, required_assets, prompt_guidelines, optional summary). No inputs/outputs or params; used for prompt generation and minimal execution payload only. See ADR-008.
  - `ResearchJob`: Research job tracking (status, errors)
- **Why important**: 
  - Enables spec-driven UI (modality, required assets)
  - Provides consistency across the system
  - Allows admin panel to manage models

## Data Flow

### Model Discovery Flow
```
User → Validate Endpoint → fal.ai API (check exists)
     → Create ModelEndpoint (status: pending_research)
     → Create ResearchJob (status: queued)
     → Process Research → Gemini API (analyze model)
     → Generate ModelSpec → Save to DB
     → Update ModelEndpoint (status: active)
```

### Prompt Generation Flow
```
User Task → Check Model Capabilities
         → If canReason: Model generates prompts (self)
         → If cannotReason: Gemini generates prompts (fallback)
         → Run prompts via fal.ai
         → Display results
```

### Playground Flow
```
Load Active Models → User Selects Model
                 → Load ModelSpec from DB (modality, required_assets)
                 → Show task goal + optional image/video upload per required_assets
                 → Run Model (minimal payload: prompt + assets)
                 → Display Results
```

## Key Design Decisions

1. **Provider-agnostic core**: Core domain logic doesn't depend on specific providers
2. **Separation of concerns**: Execution (fal.ai/EachLabs) vs Reasoning (Gemini)
3. **Spec-driven UI**: Modality and required assets from ModelSpec; no param forms
4. **Database as source of truth**: All model information normalized and stored
5. **Admin panel separation**: Management vs usage (admin never writes prompts)

## Technology Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL with Prisma ORM
- **Execution Provider**: fal.ai
- **Reasoning Provider**: Google Gemini 3 Flash
- **Language**: TypeScript (strict mode)
- **Testing**: Jest
