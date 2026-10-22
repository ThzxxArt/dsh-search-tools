/** Run an async map with a fixed concurrency ceiling. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const width = Math.max(1, Math.min(limit, items.length || 1))
  const results = new Array<R>(items.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await run(items[index] as T, index)
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()))
  return results
}

/** Clip a string to a maximum length, reporting whether it was cut. */
export function clip(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false }
  return { text: value.slice(0, max), truncated: true }
}
