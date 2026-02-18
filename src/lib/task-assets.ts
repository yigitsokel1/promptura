/**
 * Shared helpers for task input assets (image/video).
 * Used by Fal.ai and EachLabs payload builders.
 */

import type { TaskAsset } from '@/src/core/types';

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
