/**
 * Shared API route helpers
 * Reduces code duplication across API routes
 */

import { NextResponse } from 'next/server';

/**
 * Standard error response handler
 * Ensures consistent error format across all API routes
 */
export function handleApiError(
  error: unknown,
  routeName: string,
  defaultMessage = 'Internal server error'
): NextResponse {
  console.error(`Error in ${routeName}:`, error);
  const errorMessage =
    error instanceof Error ? error.message : defaultMessage;
  return NextResponse.json({ error: errorMessage }, { status: 500 });
}

/**
 * Convert ModelEndpoint source to ModelRef provider
 */
export function sourceToProvider(source: string): 'falai' | 'google' | 'openai' {
  switch (source) {
    case 'fal.ai':
      return 'falai';
    case 'google':
      return 'google';
    case 'openai':
      return 'openai';
    default:
      return 'falai'; // Default fallback
  }
}
