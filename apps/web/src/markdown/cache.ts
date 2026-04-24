// Per-message render cache — avoid re-parsing markdown on rerenders.

interface CacheEntry {
  contentHash: number;
  html: string;
}

/**
 * Fast non-cryptographic hash. FNV-1a (32-bit). Collisions acceptable at
 * per-message scope — cache miss falls back to full parse.
 */
function quickHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const map = new Map<string, CacheEntry>();

export function get(id: string, content: string): string | null {
  const entry = map.get(id);
  if (!entry) return null;
  return entry.contentHash === quickHash(content) ? entry.html : null;
}

export function put(id: string, content: string, html: string): void {
  map.set(id, { contentHash: quickHash(content), html });
}

export function invalidate(id: string): void {
  map.delete(id);
}

export function size(): number {
  return map.size;
}
