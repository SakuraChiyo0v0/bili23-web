/**
 * 带并发上限的数组映射。
 * 空间/收藏夹等容器解析要把列表页每条投稿再展开（每条一次 view 请求），
 * 全部串行太慢、全部并发易触发风控，因此用固定并发窗口逐批推进。
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}