/**
 * Database type exports
 * Re-export Prisma types for convenience
 */

export type {
  ModelEndpoint,
  ModelSpec,
  ResearchJob,
  Run,
} from '@prisma/client';

export type {
  Prisma,
} from '@prisma/client';

/**
 * UI-friendly ModelEndpoint type with relations
 * Used in admin panel and playground
 */
export interface ModelEndpointWithRelations {
  id: string;
  endpointId: string;
  kind: string;
  modality: string;
  status: string;
  source: string;
  provider: string; // "falai" | "eachlabs"
  createdAt: Date | string;
  lastCheckedAt: Date | string | null;
  modelSpecs: Array<{
    id: string;
    specJson?: unknown;
    researchedAt: Date | string;
    researchedBy?: string;
    schemaVersion?: string;
  }>;
  researchJobs?: Array<{
    id: string;
    status: string;
    error?: string | null;
    startedAt: Date | string | null;
    finishedAt?: Date | string | null;
  }>;
}
