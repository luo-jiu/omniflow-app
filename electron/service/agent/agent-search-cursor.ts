import crypto from 'node:crypto';

const key = crypto.randomBytes(32);
export function searchQueryHash(query: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(query)).digest('hex');
}
export function encodeSearchCursor(kind: string, queryHash: string, state: unknown): string {
  const payload = Buffer.from(JSON.stringify({ kind, queryHash, state })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', key).update(payload).digest('base64url')}`;
}
export function decodeSearchCursor<T>(cursor: string | undefined, kind: string, queryHash: string): T | undefined {
  if (!cursor) return undefined;
  try {
    if (cursor.length > 4096) throw new Error();
    const [payload, signature, extra] = cursor.split('.');
    const expected = crypto.createHmac('sha256', key).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (extra || expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error();
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.kind !== kind || data.queryHash !== queryHash) throw new Error();
    return data.state as T;
  } catch { throw new Error('搜索游标无效、已过期或筛选条件发生变化，请从第一页重新搜索'); }
}
