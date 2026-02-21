/**
 * Shared helpers for task input assets (image/video).
 * Used by Fal.ai and EachLabs payload builders.
 */

import type { TaskAsset, TaskSpec } from '@/src/core/types';

export interface TaskInputsLike {
  image?: string;
  video?: string;
  assets?: TaskAsset[];
}

/** Convert task inputs to TaskAsset[]. Prefers assets array, falls back to image/video fields. */
export function taskInputsToAssets(taskInputs?: TaskInputsLike): TaskAsset[] {
  if (!taskInputs) return [];
  if (taskInputs.assets?.length) return taskInputs.assets;
  const out: TaskAsset[] = [];
  if (taskInputs.image) out.push({ type: 'image', url: taskInputs.image });
  if (taskInputs.video) out.push({ type: 'video', url: taskInputs.video });
  return out;
}

const DATA_URL_PREFIX = 'data:';

/**
 * Returns a task payload safe to store in the DB (Prisma 5MB limit).
 * Replaces inline data URLs (base64) in assets with a short placeholder so
 * task_json stays small. Use the full task in memory for background jobs;
 * store this result in createIterationRecord.
 */
export function taskJsonForStorage(task: TaskSpec): { goal: string; modality: TaskSpec['modality']; assets?: { type: 'image' | 'video'; url: string }[] } {
  const assets = task.assets?.map((a) => ({
    type: a.type,
    url: a.url.startsWith(DATA_URL_PREFIX) ? '(inline omitted)' : a.url,
  }));
  return {
    goal: task.goal,
    modality: task.modality,
    ...(assets?.length ? { assets } : {}),
  };
}
