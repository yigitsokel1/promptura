# ADR-008: Param-Free ModelSpec and Execution Payload

**Status**: Accepted  
**Date**: 2026-02  
**Context**: Sprint 7 — Param-Free Promptura (cleanup and consistency)

## Summary

ModelSpec and the execution payload contain **no model parameters** (no aspect_ratio, seed, style_id, num_images, steps, etc.). Only **modality**, **required_assets**, and **prompt_guidelines** (plus optional summary) are stored and used. Gemini research produces **only prompt guidelines and summary**; it never infers or outputs parameters or asset requirements. This ADR explains why.

---

## 1. Why no params in ModelSpec?

**Decision:** ModelSpec holds only: `modality`, `required_assets`, `prompt_guidelines`, `summary?`. No `inputs[]`, `outputs`, enums, min/max, or default values.

### Rationale

- **Single mental model:** The product is “prompt + (optional) assets.” Parameters are an implementation detail of each provider; we do not expose or store them. Users never see or fill param forms; the UI is the same for every model (task + asset upload when required).
- **Avoid “form blocking”:** Requiring users to fill aspect_ratio, seed, style_id, etc. leads to “I can’t try because I don’t know what to put.” Param-free keeps the bar low: pick model, write task, add image/video if needed, generate.
- **Provider defaults:** Execution providers (fal.ai, EachLabs) have sensible defaults for all parameters. We send only `prompt` and, when required, `image_url` / `video_url`. Providers use their own defaults for everything else; we never guess or store them.
- **Stability and maintenance:** Param schemas vary by provider and change over time. By not storing or mapping params, we avoid drift, validation bugs, and UI that breaks when a provider adds/removes a field.
- **Consistency:** Same payload shape for all models: minimal and deterministic. Run failures are not caused by wrong or missing param values.

### Consequences

- No param forms in the UI. No param mapping in provider adapters beyond the single source of truth in `src/lib/execution-payload.ts` (prompt + image_url/video_url when required).
- DB and API never store or return parameter definitions. Research output is guidelines and asset requirement only.

---

## 2. Why doesn’t Gemini research params?

**Decision:** Gemini research returns only **prompt_guidelines** and optional **summary**. Modality and required_assets come from provider metadata (or derivation), not from Gemini. Gemini **never** infers or outputs parameters or asset requirements.

### Rationale

- **Reliability:** Gemini can hallucinate parameter names, enums, or ranges that don’t match the real API. Using it only for “how to write good prompts for this modality” avoids wrong params breaking runs.
- **Single source of truth for assets:** Asset requirements (image/video input) are derived from provider metadata or from a future, minimal schema layer—not from free-form LLM output. That keeps execution deterministic and errors clear (“Image required.” / “Video required.”).
- **Clear responsibility:** Research = “what should good prompts look like for this model?” (guidelines + summary). Not “what parameters does the API accept?” (we don’t store or send those).
- **Simpler pipeline:** No merging of Gemini params with schema; no param validation. Research job output is always guidelines + summary; modality/required_assets are derived once and stored.

### Consequences

- Research pipeline: derive modality + required_assets from metadata (or future minimal detector); call Gemini only for `prompt_guidelines` and `summary`; merge into ModelSpec and save.
- No schema converters that extract params (removed in Sprint 7). No “Gemini guessed params” path.

---

## Related documents

- **ADR-004:** Iteration and Refine Design (task-based loop, Gemini as prompt creator).
- **README:** How Promptura works; Model discovery (param-free research flow).
- **Architecture:** ModelSpec and execution payload as single source of truth; no param forms in UI.
