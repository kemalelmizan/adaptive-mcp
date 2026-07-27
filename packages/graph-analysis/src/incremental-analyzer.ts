import type { MemoryStore } from "@adaptivemcp/memory";
import type { ExecutionNode } from "@adaptivemcp/spec";
import { GraphAnalyzer } from "./analyzer.js";

export interface IncrementalGraphAnalyzerOptions {
  /** How long a cached read is considered fresh before a fetch re-queries the store. Default 5000ms. */
  maxCacheAgeMs?: number;
}

interface CacheEntry {
  nodes: ExecutionNode[];
  fetchedAt: number;
}

/**
 * `GraphAnalyzer` re-queries and re-scans the full node set on every call,
 * which is wasted work for long-running workflows being polled repeatedly
 * (e.g. an extension resource read against a session that's still
 * accumulating nodes) while nothing has actually changed. This subclass
 * caches the flat node list per session/workflow id and only re-queries the
 * store when the cache is stale or explicitly invalidated — the derived
 * graph algorithms (critical path, bottlenecks, etc.) are unchanged and
 * still run against the cached array.
 *
 * This is deliberately not "streaming": there is no event bus from
 * `MemoryStore` writes to analyzer instances anywhere in this codebase, so
 * true incremental recomputation isn't wired up. Callers that write new
 * nodes and want the next read to reflect them immediately should call
 * `invalidate(id)` right after the write.
 */
export class IncrementalGraphAnalyzer extends GraphAnalyzer {
  private readonly maxCacheAgeMs: number;
  private readonly sessionCache = new Map<string, CacheEntry>();
  private readonly workflowCache = new Map<string, CacheEntry>();

  constructor(memory: MemoryStore, options: IncrementalGraphAnalyzerOptions = {}) {
    super(memory);
    this.maxCacheAgeMs = options.maxCacheAgeMs ?? 5000;
  }

  protected override fetchSessionNodes(sessionId: string): ExecutionNode[] {
    return this.readThrough(this.sessionCache, sessionId, () => super.fetchSessionNodes(sessionId));
  }

  protected override fetchWorkflowNodes(workflowId: string): ExecutionNode[] {
    return this.readThrough(this.workflowCache, workflowId, () => super.fetchWorkflowNodes(workflowId));
  }

  /** Drop the cached entry for `id`, forcing the next read to re-query the store. */
  invalidate(id: string): void {
    this.sessionCache.delete(id);
    this.workflowCache.delete(id);
  }

  /** Drop every cached entry. */
  invalidateAll(): void {
    this.sessionCache.clear();
    this.workflowCache.clear();
  }

  private readThrough(cache: Map<string, CacheEntry>, id: string, fetch: () => ExecutionNode[]): ExecutionNode[] {
    const cached = cache.get(id);
    if (cached && Date.now() - cached.fetchedAt < this.maxCacheAgeMs) {
      return cached.nodes;
    }
    const nodes = fetch();
    cache.set(id, { nodes, fetchedAt: Date.now() });
    return nodes;
  }
}
