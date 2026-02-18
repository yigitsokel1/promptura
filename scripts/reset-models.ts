/**
 * Reset all models: clears ModelEndpoint, ModelSpec, ResearchJob, Run, Iteration.
 * Param-free: no param or spec state to clear; just removes DB entities for a fresh start.
 * Re-add models via Playground or Admin. Run: npx tsx scripts/reset-models.ts (or npm run db:reset-models)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Resetting all models and related data...');

  const runCount = await prisma.run.deleteMany();
  console.log(`  Deleted ${runCount.count} Run(s)`);

  const iterationCount = await prisma.iteration.deleteMany();
  console.log(`  Deleted ${iterationCount.count} Iteration(s)`);

  const specCount = await prisma.modelSpec.deleteMany();
  console.log(`  Deleted ${specCount.count} ModelSpec(s)`);

  const jobCount = await prisma.researchJob.deleteMany();
  console.log(`  Deleted ${jobCount.count} ResearchJob(s)`);

  const endpointCount = await prisma.modelEndpoint.deleteMany();
  console.log(`  Deleted ${endpointCount.count} ModelEndpoint(s)`);

  console.log('Done. You can now add models via Admin or /api/models/validate.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
