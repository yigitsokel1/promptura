# Modality Test Matrix (Blok F)

Sprint 6 minimum: **en az 3 modalite gerçek çalışmalı**.

---

## 0) Discovery — Proje durumu

### Çekirdek akışlar

- **Admin → Model ekle/refresh:** `app/api/admin/models/*` → ModelEndpoint; ResearchJob oluşturulur.
- **Research:** `src/lib/research-helpers.ts` → provider metadata + **schema-asset-analyzer** (tek motor) + Gemini research → ModelSpec yazımı.
- **Playground / Iteration:** Task → Gemini candidate prompts → provider execution (fal.ai / eachlabs) → OutputAsset normalize → seçim + refine loop.

### En kritik “sistem contract’ı”

**ModelSpec.modality** ve **ModelSpec.required_assets** tek otoriteden gelir: **schema-asset-analyzer** (property keys + required → allowlist + denylist). Bunlar yanlışsa UI yanlış asset ister, payload yanlış kurulur.

- **fal.ai:** OpenAPI requestBody schema → `getFalOpenApiInputPropertyKeys()` → `analyzeSchemaForAssets()`.
- **eachlabs:** `request_schema.properties` + `required` → `eachLabsRequiredAssets()` (sadece wrapper) → `analyzeSchemaForAssets()`.

Naive heuristic (örn. `key.includes('image')`) kaldırıldı; `image_size`, `num_images` vb. denylist ile T2I modellerde `required_assets=none` kalıyor.

---

## Target Matrix

| Provider | Modality        | Status   | Notes                          |
|----------|-----------------|----------|--------------------------------|
| fal.ai   | text-to-image   | verified | prompt only, image output      |
| fal.ai   | image-to-image  | verified | prompt + image input, image out|
| eachlabs | image-to-video  | verified | image + prompt, video output   |
| fal.ai   | text-to-video   | verified | prompt only, video output      |
| eachlabs | text-to-video   | verified | capability supported           |

---

## Gerçek model slug listesi (integration test fixtures)

Aşağıdaki slug’lar `app/api/research/process/__tests__/process.test.ts` içinde mock schema ile kullanılıyor; beklenen `required_assets` / modality doğrulanıyor.

| Slug | Provider | Beklenen modality | Beklenen required_assets | Schema fixture (öz) |
|------|----------|-------------------|--------------------------|----------------------|
| `fal-ai/flux/dev` | fal.ai | text-to-image | none | prompt, num_images, image_size |
| `fal-ai/flux-pro/v1.1/image-to-image` | fal.ai | image-to-image | image | prompt, image_url (required) |
| `fal-ai/flux-pro/v1.1/image-to-image` (init) | fal.ai | image-to-image | image | prompt, init_image, num_steps |
| `fal-ai/flux/inpaint` | fal.ai | image-to-image | image | prompt, image_url, mask_image_url |
| `fal-ai/minimax/video-01` | fal.ai | image-to-video | image | prompt, image_url, motion_bucket_id |
| `fal-ai/kling-video/v1.6/video-to-video` | fal.ai | video-to-video | video | prompt, video_url |
| `fal-ai/recraft-v3` | fal.ai | text-to-image | image (optional fallback) | prompt, image_url, num_steps; required: [prompt] |
| `eachlabs/stable-diffusion` | eachlabs | text-to-image | none | prompt, num_inference_steps |
| `eachlabs/image-editor` | eachlabs | image-to-image | image | prompt, image_url (required) |
| `eachlabs/multi-modal` | eachlabs | (video) | image+video | prompt, image_url, video_url (required) |

Denylist davranışı: `image_size`, `num_images`, `image_width` vb. **asset sayılmaz** → T2I config-only schema → `required_assets=none`.

---

## Test Coverage

- **Unit:** `src/lib/__tests__/schema-asset-analyzer.test.ts` — T2I config-only, I2I (init_image, mask_image_url), I2V, V2V, optional fallback, denylist.
- **Unit:** `src/lib/__tests__/modality-inference.test.ts` — isImageAssetKey / isVideoAssetKey, inferRequiredAssetsFromPropertyKeys, combineOutputAndAssetsToModality.
- **Integration:** `app/api/research/process/__tests__/process.test.ts` — yukarıdaki slug’lar + mock schema → ModelSpec.modality / required_assets assert.

`src/lib/__tests__/modality-matrix.test.ts`:

1. **buildExecutionPayload**: payload structure per modality (prompt only vs prompt + image_url).
2. **convertFalAIOutputToOutputAssets**: output → OutputAsset[].
3. **Provider buildPayload + convertToOutputAssets**: full path.
4. **supportsModality(provider, modality)**.

## Flow

```
TaskSpec (modality + assets) → buildExecutionPayload → provider.submit
                                                          ↓
Result ← provider.convertToOutputAssets(rawOutput) ← getResult
```

Modality/required_assets kaynağı:

```
fal: OpenAPI schema → getFalOpenApiInputPropertyKeys → analyzeSchemaForAssets
eachlabs: request_schema.properties + required → analyzeSchemaForAssets (eachLabsRequiredAssets wrapper)
         → modality-inference (allowlist + denylist) → required_assets + modality
```

## Running Tests

```bash
npm run test -- src/lib/__tests__/modality-matrix.test.ts
npm run test -- src/lib/__tests__/schema-asset-analyzer.test.ts
npm run test -- src/lib/__tests__/modality-inference.test.ts
npm run test -- app/api/research/process/__tests__/process.test.ts
```
