/**
 * Concurrency control utilities
 * Limits concurrent execution of async operations
 */

/**
 * Process items with limited concurrency
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param concurrencyLimit - Maximum number of concurrent operations (default: 10)
 * @returns Array of results in the same order as items
 */
export async function limitConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrencyLimit = 10
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing: Set<Promise<void>> = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // Create a promise that processes the item and removes itself when done
    const promise = (async () => {
      try {
        const result = await processor(item, i);
        results[i] = result;
      } finally {
        executing.delete(promise);
      }
    })();

    executing.add(promise);

    // If we've reached the concurrency limit, wait for one to complete
    if (executing.size >= concurrencyLimit) {
      await Promise.race(Array.from(executing));
    }
  }

  // Wait for all remaining promises to complete
  await Promise.all(Array.from(executing));

  return results;
}

/**
 * Process items with limited concurrency (allSettled version)
 * Similar to limitConcurrency but uses Promise.allSettled for error handling
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param concurrencyLimit - Maximum number of concurrent operations (default: 10)
 * @returns Array of settled results in the same order as items
 */
export async function limitConcurrencySettled<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrencyLimit = 10
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const executing: Set<Promise<void>> = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // Create a promise that processes the item and removes itself when done
    const promise = (async () => {
      try {
        const result = await processor(item, i);
        results[i] = { status: 'fulfilled', value: result };
      } catch (error) {
        results[i] = { status: 'rejected', reason: error };
      } finally {
        executing.delete(promise);
      }
    })();

    executing.add(promise);

    // If we've reached the concurrency limit, wait for one to complete
    if (executing.size >= concurrencyLimit) {
      await Promise.race(Array.from(executing));
    }
  }

  // Wait for all remaining promises to complete
  await Promise.all(Array.from(executing));

  return results;
}
