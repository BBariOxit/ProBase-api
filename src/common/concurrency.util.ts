/**
 * Runs `task` over every item with at most `limit` of them in flight.
 *
 * The two callers that need this are bulk import's password hashing and its
 * credential mailing: both want parallelism (serial is far too slow for a
 * roster) but neither can use a bare Promise.all, which would put every row in
 * flight at once and either saturate the libuv thread pool or trip the mail
 * provider's rate limit.
 *
 * Results are returned in input order. Rejections propagate, so callers that
 * need per-item failure handling should have `task` resolve to a result object
 * rather than throw.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await task(items[index], index);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
