# ADR-005: Why Gemini key is centralized

**Status**: Accepted  
**Date**: 2025-02-12  
**Context**: Blok F — Documentation; Sprint 5 multi-provider and user API keys

## Summary

Prompt generation (candidate prompts and refine) uses a **single, server-side Gemini API key** (from environment), not per-user keys. This ADR records why that choice was made and what the implications are.

---

## Decision

**Gemini API key is centralized:** one key per deployment (e.g. `GEMINI_API_KEY` in env). It is used for:

- Model research (Gemini analyzes fal.ai/EachLabs metadata and produces ModelSpec).
- Generate (Gemini produces N candidate prompts from task + ModelSpec).
- Refine (Gemini produces M prompts from task + selected prompts + notes + output summaries).

Users do **not** supply or manage a Gemini key. Execution providers (fal.ai, EachLabs) use **per-user** keys (see README “User API Keys”).

---

## Rationale

1. **Single prompt author, not multi-tenant LLM usage**  
   Gemini is used as the “brain” that writes prompts and researches models. That is a platform capability, not a user-facing “run my model” feature. Centralizing the key keeps configuration and billing in one place and avoids asking every user to bring a Gemini key.

2. **Consistency and quality**  
   One key → one quota and one place to tune (e.g. model, safety, rate limits). All users get the same prompt-generation behavior and the same research pipeline. Quality and cost are easier to reason about and improve.

3. **Separation of concerns**  
   - **Execution** (fal.ai, EachLabs): user-specific keys make sense — the user’s account is charged for image/video runs.  
   - **Prompt authoring** (Gemini): the product is “we help you find the best prompt”; the platform runs Gemini on the user’s behalf. User keys would shift cost and configuration to the user and complicate onboarding.

4. **Operational simplicity**  
   No need to validate, store, or rotate per-user Gemini keys. No UI for “add your Gemini key.” Fewer failure modes (e.g. invalid or revoked user key) and a single point for monitoring and limits.

5. **Research pipeline**  
   Model research (Gemini analyzing metadata and producing ModelSpec) is an admin/platform action. It naturally uses a system key; tying it to a user key would be inconsistent and would require an admin to “own” a Gemini key for research.

---

## Consequences

- **Cost**: All Gemini usage (research + generate + refine) is billed to the deployment’s Gemini project. Rate limits and quotas are global for the app, not per user.
- **Trust**: Users trust the platform to call Gemini with their task and feedback; prompts and context are not sent to a user-owned key. This is consistent with “we run the iteration loop for you.”
- **Scaling**: At very large scale, a single key may hit provider limits; then options include multiple keys with routing or a dedicated quota increase. The decision to centralize remains; only the implementation of “one logical key” might change.

---

## Alternatives considered

- **Per-user Gemini keys**: Would allow “bring your own Gemini” and shift cost to users, but would complicate onboarding, research (who owns the key for model research?), and support. Rejected for the current product shape.
- **Optional user key override**: Could allow power users to supply a Gemini key while defaulting to the central key. Adds complexity and two code paths; deferred unless there is a clear requirement.

---

## References

- README: [User API Keys](README.md#user-api-keys), [Multi-provider architecture](README.md#multi-provider-architecture)
- ADR-002: Gemini Research Pipeline  
- ADR-004: Iteration and Refine Design (Gemini as single prompt creator)
