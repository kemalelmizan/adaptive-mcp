import type { Store, ToolExecutionEvent } from "@adaptivemcp/spec";
import type { TelemetryStore } from "./store.js";

/**
 * Telemetry store that keeps a recent event log in memory AND folds every event
 * into the SQLite-backed MemoryStore (the store). This keeps the hot event log
 * cheap while ensuring durable stats accumulate over time.
 */
export class MemoryBackedTelemetryStore implements TelemetryStore {
  private events = new Map<string, ToolExecutionEvent>();
  private memory: Store;

  constructor(memory: Store) {
    this.memory = memory;
  }

  record(event: ToolExecutionEvent): void {
    this.events.set(event.id, event);
    this.memory.recordExecution(event);
  }

  get(id: string): ToolExecutionEvent | undefined {
    return this.events.get(id);
  }

  byTool(toolName: string): ToolExecutionEvent[] {
    return this.all().filter((e) => e.toolName === toolName);
  }

  all(): ToolExecutionEvent[] {
    return [...this.events.values()].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
  }

  clear(): void {
    this.events.clear();
  }
}
