/**
 * Phase-2 scaffold: canonical input profile for image/video conditioned video models.
 * Not active in execution yet; this defines the mapping contract.
 */
export type CanonicalVideoInputField =
  | 'primaryImage'
  | 'firstFrame'
  | 'lastFrame'
  | 'firstClip';

export interface VideoInputProfile {
  fields: Partial<Record<CanonicalVideoInputField, string>>;
  required: CanonicalVideoInputField[];
}

export const DEFAULT_VIDEO_INPUT_PROFILE: VideoInputProfile = {
  fields: {},
  required: [],
};
