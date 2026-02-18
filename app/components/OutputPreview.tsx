'use client';

import Image from 'next/image';
import type { OutputAsset } from '@/src/core/types';

interface OutputPreviewProps {
  asset: OutputAsset;
  onImageClick?: (url: string) => void;
  className?: string;
}

/**
 * Renders a single OutputAsset: image → img, video → video, text → pre.
 * Modality-agnostic preview component.
 */
export function OutputPreview({ asset, onImageClick, className = '' }: OutputPreviewProps) {
  switch (asset.type) {
    case 'image':
      return (
        <button
          type="button"
          onClick={() => onImageClick?.(asset.url)}
          className={`relative block aspect-square w-full min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 shadow-sm transition hover:shadow focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 ${className}`}
        >
          <Image
            src={asset.url}
            alt="Output"
            fill
            className="object-cover cursor-pointer"
            unoptimized
          />
        </button>
      );
    case 'video':
      return (
        <video
          src={asset.url}
          controls
          className={`w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-700 ${className}`}
        />
      );
    case 'text':
      return (
        <pre className={`whitespace-pre-wrap overflow-auto rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 ${className}`}>
          {asset.content}
        </pre>
      );
    default:
      return null;
  }
}
