# Setup and operations

Operational guide for running Promptura locally: auth, provider keys, and the model catalog.

For architecture overview, see [architecture.md](architecture.md). For design decisions, see [adr/](adr/).

## Environment

Copy `.env.example` to `.env.local` and configure:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth (NextAuth v5) |
| `PROVIDER_KEY_ENCRYPTION_SECRET` | AES-256-GCM for user provider keys |
| `GEMINI_API_KEY` | Server-side model research (admin flows) |
| `FAL_AI_API_KEY`, `EACHLABS_API_KEY` | Optional server keys for admin validate/research |

## Authentication

- **Login**: Google OAuth via NextAuth v5.
- **Protected routes**:
  - **Login required**: `/playground`, `/settings` — redirect to `/login` if not signed in.
  - **ADMIN only**: `/admin/*` — requires `users.role = 'ADMIN'` in the database.
- **Role from DB**: `users.role` (`ADMIN` | `USER`) is the source of truth; JWT session is refreshed on sign-in from DB.
- **First admin**: After signing in once with Google:

  ```bash
  node scripts/set-admin.js your@email.com
  ```

  Or: `UPDATE users SET role = 'ADMIN' WHERE email = 'your@email.com';`

  Sign out and sign in again so the session picks up the new role.

- **API routes**: Iteration, playground, and settings APIs use `requireAuth()` or `requireAdmin()`. Status polling resolves keys via the iteration’s `userId`.

## Provider keys

Users configure keys in **Settings → Provider keys**:

- **fal.ai** and **EachLabs** — required for running generations in the Playground.
- **Gemini** — used for generate/refine prompt authoring in the Playground.
- Keys are never returned to the client or logged.
- Encrypted at rest (AES-256-GCM) with `PROVIDER_KEY_ENCRYPTION_SECRET`; plaintext only in memory during requests.
- Missing key: API returns `400` with `code: 'MissingProviderKey'`.

Admin model research uses the server `GEMINI_API_KEY` when set. See [ADR-005: Gemini Key Strategy](adr/ADR-005-gemini-key-centralized.md).

## Model catalog

### Discovery flow

1. **Validation** — endpoint checked against the provider API (Playground or admin).
2. **Research** — Gemini analyzes metadata and produces a param-free `ModelSpec` (modality, required assets, prompt guidelines, optional summary).
3. **Activation** — status becomes `active`; model appears in the Playground.

See [ADR-008: Param-Free ModelSpec](adr/ADR-008-param-free-model-spec.md).

### Add a model (Playground)

1. Go to `/playground`.
2. In **Add New Model**, enter a fal.ai or EachLabs endpoint ID (e.g. `fal-ai/flux/dev`).
3. Click **Add Model** — validates, creates `ModelEndpoint` (`pending_research`), queues research.
4. Wait for research (~10–30s); status becomes `active`.

```
endpoint_id → POST /api/models/validate → provider check
  → ModelEndpoint (pending_research) → ResearchJob
  → Gemini ModelSpec → status active
```

### Reset models

```bash
npm run db:reset-models
```

Then re-add via Playground or Admin. Suggested endpoints:

| Provider | Modality | Endpoint ID |
|----------|----------|-------------|
| fal.ai | text-to-image | `fal-ai/flux/dev` |
| fal.ai | image-to-image | `fal-ai/flux/dev/image-to-image` |
| fal.ai | text-to-video | `fal-ai/minimax-video-01` |
| eachlabs | text-to-video | `haiper-video-2` |

### Errors

- **Invalid endpoint** — 404 with a clear message.
- **Already exists** — returns existing model (no duplicate).
- **Research fails** — stays `pending_research`; retry from Admin.

## Admin panel

`/admin/models` — model list, details, status (active / disabled / pending_research), research refresh, delete (cascade). Does not edit prompts.

`/admin/iterations` — inspect iteration and run status.

Refresh research: `/admin/models/[id]` → **Start Research** regenerates the ModelSpec.

## Video scope

- **Phase 1**: `text-to-video` (fal.ai + EachLabs).
- **Deferred**: `image-to-video`, `video-to-video` (profile-based adapter planned).

## Adding an execution provider

Implement `ExecutionProvider` (submit, status, result), register in the factory, add `provider` + `endpointId` in the catalog. See `src/providers/execution/`.
