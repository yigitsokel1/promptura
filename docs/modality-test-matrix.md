# Modality Test Matrix (Blok F)

Sprint 6 minimum: **en az 3 modalite gerçek çalışmalı**.

## Target Matrix

| Provider | Modality        | Status   | Notes                          |
|----------|-----------------|----------|--------------------------------|
| fal.ai   | text-to-image   | verified | prompt only, image output      |
| fal.ai   | image-to-image  | verified | prompt + image input, image out|
| eachlabs | image-to-video  | verified | image + prompt, video output   |
| fal.ai   | text-to-video   | verified | prompt only, video output      |
| eachlabs | text-to-video   | verified | capability supported           |

## Test Coverage

Integration tests live in `src/lib/__tests__/modality-matrix.test.ts`:

1. **buildExecutionPayload**: Verifies payload structure per modality
   - text-to-image: `prompt` only
   - image-to-image: `prompt` + `image_url` from `taskAssets`
   - image-to-video: `prompt` + `image_url` from `taskAssets`
   - text-to-video: `prompt` only

2. **convertFalAIOutputToOutputAssets**: Verifies output → OutputAsset[] conversion
   - image: `{ images }`, `url[]`, etc.
   - video: `{ videos }`, `{ urls }`, etc.

3. **Provider buildPayload + convertToOutputAssets**: Each provider exercises the full path

4. **Provider capability**: `supportsModality(provider, modality)` for safety

## Flow

```
TaskSpec (modality + assets) → buildExecutionPayload → provider.submit
                                                          ↓
Result ← provider.convertToOutputAssets(rawOutput) ← getResult
```

## Running Tests

```bash
npm run test -- src/lib/__tests__/modality-matrix.test.ts
```
