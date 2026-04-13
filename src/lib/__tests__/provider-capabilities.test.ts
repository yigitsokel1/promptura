/**
 * Unit tests: Provider Capability Matrix (Blok E)
 */

import { getProviderCapability, supportsModality } from '../provider-capabilities';

describe('provider-capabilities', () => {
  describe('getProviderCapability', () => {
    it('returns capability for falai', () => {
      const cap = getProviderCapability('falai');
      expect(cap.supports.textToImage).toBe(true);
      expect(cap.supports.imageToImage).toBe(true);
      expect(cap.supports.textToVideo).toBe(true);
    });

    it('returns capability for eachlabs', () => {
      const cap = getProviderCapability('eachlabs');
      expect(cap.supports.textToImage).toBe(true);
      expect(cap.supports.videoToVideo).toBe(false);
    });

    it('returns capability with all support keys', () => {
      const cap = getProviderCapability('falai');
      expect(Object.keys(cap.supports)).toContain('textToText');
      expect(Object.keys(cap.supports)).toContain('textToImage');
      expect(Object.keys(cap.supports)).toContain('videoToVideo');
    });
  });

  describe('supportsModality', () => {
    it('returns true for supported modalities (falai)', () => {
      expect(supportsModality('falai', 'text-to-image')).toBe(true);
      expect(supportsModality('falai', 'image-to-image')).toBe(true);
      expect(supportsModality('falai', 'image-to-video')).toBe(false);
      expect(supportsModality('falai', 'text-to-video')).toBe(true);
      expect(supportsModality('falai', 'video-to-video')).toBe(false);
      expect(supportsModality('falai', 'text-to-text')).toBe(true);
    });

    it('returns true for supported modalities (eachlabs)', () => {
      expect(supportsModality('eachlabs', 'text-to-image')).toBe(true);
      expect(supportsModality('eachlabs', 'text-to-video')).toBe(true);
    });
  });
});
