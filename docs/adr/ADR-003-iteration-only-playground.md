# ADR-003: Iteration-Only Playground

**Status**: Accepted  
**Date**: 2025-01-28  
**Context**: Sprint 3 Revise

## Problem

The Playground initially supported two modes:
1. **Manual Mode**: Users manually enter prompts and model parameters, then run a single model execution
2. **Iteration Mode**: Users enter a task, system generates 20 candidate prompts, user selects best ones, refines to 10

This dual-mode approach created confusion and complexity:
- Users had to understand when to use which mode
- Manual mode bypassed the core value proposition (AI-powered prompt discovery)
- Manual mode required users to understand model-specific parameters
- The UI was cluttered with both modes

## Decision

**Remove Manual Mode entirely. Playground is now Iteration-only.**

The Playground now exclusively supports the iterative prompt discovery flow:
1. User enters a **task goal** (not a prompt)
2. System generates 20 candidate prompts using Gemini (with ModelSpec awareness)
3. User reviews results, selects preferred candidates, adds notes
4. User refines to get 10 improved prompts based on feedback
5. Process repeats as needed

### Key Changes

- **Removed**: Manual prompt input field
- **Removed**: Model parameter inputs (aspect_ratio, num_images, seed, safety_filter_level, etc.)
- **Removed**: "Run Model" button for single execution
- **Removed**: "Add New Model" section from Playground (moved to Admin Panel)
- **Kept**: Model selection dropdown (for choosing which model to iterate with)
- **Kept**: Task goal textarea
- **Kept**: Modality selection
- **Kept**: "Generate 20 Candidates" button
- **Kept**: Results grid with select + note functionality
- **Kept**: "Refine (10 candidates)" button

### User Flow

```
User → Select Model → Enter Task Goal → Select Modality
     → Click "Generate 20 Candidates"
     ↓
System → Gemini generates 20 prompts (using ModelSpec)
      → fal.ai Queue API submits 20 jobs
      → UI polls for status
      → Results displayed in grid
     ↓
User → Select best candidates → Add notes
     → Click "Refine (10 candidates)"
     ↓
System → Gemini generates 10 refined prompts (using feedback)
      → fal.ai Queue API submits 10 jobs
      → UI polls for status
      → Results displayed in grid
     ↓
Repeat as needed
```

## Alternatives Considered

### Alternative 1: Keep both modes with toggle
**Rejected because:**
- Adds UI complexity
- Confuses users about which mode to use
- Manual mode doesn't align with product vision (AI-powered discovery)
- Maintenance burden for two different flows

### Alternative 2: Move Manual Mode to Admin Panel
**Rejected because:**
- Admin Panel is for management, not execution
- Doesn't solve the core problem (manual mode shouldn't exist)
- Still requires maintaining two code paths

### Alternative 3: Keep Manual Mode but hide it
**Rejected because:**
- Technical debt
- Confusing for developers
- Doesn't align with Sprint 3 goals

## Consequences

### Positive
- **Simplified UX**: Single, clear flow for all users
- **Aligned with vision**: Focuses on AI-powered prompt discovery
- **Less code to maintain**: Removed ~400 lines of Manual Mode UI
- **Better user outcomes**: Users discover better prompts through iteration
- **ModelSpec-driven**: All prompts generated with ModelSpec awareness

### Negative
- **Loss of direct control**: Users can't manually craft a single prompt
- **Requires iteration**: Users must go through generate → select → refine cycle
- **No single-run testing**: Can't quickly test one prompt idea

### Mitigation
- **Admin Panel**: Model management and research still available
- **Iteration is fast**: Queue API + polling means results come quickly
- **Better prompts**: AI-generated prompts are typically better than manual ones

## Implementation Notes

- Playground UI (`/app/playground/page.tsx`) now matches Iteration UI (`/app/iterations/page.tsx`)
- All Manual Mode components removed:
  - `renderInputField()` function
  - `formValues` state
  - `handleRun()` function
  - Model parameter inputs
  - Prompt guidelines display (now used internally by Gemini)
- API endpoints unchanged (still use `/api/iterations/generate` and `/api/iterations/refine`)

## Related ADRs

- **ADR-002**: Gemini Research Pipeline (ModelSpec generation)
- Future ADR: May document prompt generation strategy if it evolves
