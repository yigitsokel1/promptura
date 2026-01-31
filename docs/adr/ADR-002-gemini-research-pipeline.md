# ADR-002: Gemini Research Pipeline

**Status**: Accepted  
**Date**: 2025-01-27  
**Context**: Sprint 2

## Problem

Fal.ai models have varying schemas, documentation quality, and parameter structures. Each model may have:
- Different input parameter names and types
- Inconsistent documentation
- Varying output formats
- Different prompt writing requirements
- Workflow-specific steps (for workflows)

This makes it impossible to build a generic UI that works for all models without hardcoding model-specific logic.

## Decision

Use Gemini to perform deep research on each model and generate a normalized `ModelSpec` that:
- Extracts input/output specifications
- Generates prompt writing guidelines
- Identifies recommended parameter ranges
- Understands workflow steps (for workflows)
- Stores everything in a consistent JSON schema

The research pipeline:
1. Validates model exists in fal.ai
2. Creates a research job
3. Gemini analyzes model metadata and generates spec
4. Spec is saved to database
5. Model status becomes `active`

### User Flow: Adding a Model

The complete user flow from adding a model to it being ready for use:

```
User Action: Enter endpoint_id in Playground
    ↓
POST /api/models/validate
    ├─ Validate endpoint exists in fal.ai
    ├─ Create ModelEndpoint (status: pending_research)
    └─ Create ResearchJob (status: queued)
    ↓
Background Process: Auto-trigger /api/research/process
    ├─ Update ResearchJob (status: running)
    ├─ Fetch model metadata from fal.ai
    ├─ Call Gemini researchModel()
    │   └─ Gemini analyzes metadata → generates ModelSpec JSON
    ├─ Save ModelSpec to database
    ├─ Update ModelEndpoint (status: active)
    └─ Update ResearchJob (status: done)
    ↓
Model ready: Status = active, Spec available
    ↓
Playground UI: Model appears in dropdown, spec-driven form generated
```

**Key Points:**
- Research is triggered automatically when model is validated
- User doesn't need to wait - research happens in background
- Playground polls for status updates (every 3 seconds)
- Model becomes usable once status = active and spec exists

## Alternatives Considered

### Alternative 1: Use fal.ai's LLM directly
**Rejected because:**
- Fal.ai focuses on execution (image/video generation), not reasoning
- Would require using fal.ai's LLM endpoints which may not be available for all models
- Less control over the research process
- Gemini provides superior reasoning capabilities for this task

### Alternative 2: Manual spec creation
**Rejected because:**
- Doesn't scale to hundreds of models
- Requires domain expertise for each model
- Error-prone and time-consuming
- Can't keep up with model updates

### Alternative 3: Parse fal.ai documentation automatically
**Rejected because:**
- Documentation quality varies significantly
- Many models lack comprehensive documentation
- Can't extract prompt guidelines from docs alone
- Doesn't understand model behavior, only describes it

## Consequences

### Positive
- **Spec-driven UI**: Playground generates forms dynamically from specs
- **Normalized data**: All models use the same schema structure
- **Admin panel**: Can refresh research to update specs when models change
- **Scalable**: Can research hundreds of models automatically
- **Consistent**: All models follow the same spec format

### Negative
- **Dependency on Gemini**: Research requires Gemini API access
- **Cost**: Each research job calls Gemini API
- **Latency**: Research jobs take time to complete
- **Potential inaccuracies**: Gemini may misinterpret model capabilities

### Mitigations
- Research jobs are async and can be retried
- Specs can be manually reviewed and refreshed via admin panel
- Gemini calls are mocked in tests to avoid costs
- Research results are stored in DB, reducing need for re-research

## Implementation Notes

- Research jobs are queued and processed asynchronously
- Gemini is mocked in tests (no real API calls)
- Specs are versioned (schemaVersion field)
- Old specs are overwritten on refresh (not versioned historically)
- Model status tracks research state (pending_research → active)

## Related ADRs

- ADR-001: Provider-agnostic core domain (if exists)
- Future: ADR-003: Spec versioning strategy (if needed)
