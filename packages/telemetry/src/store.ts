import type { ToolExecutionEvent } from "@adaptivemcp/spec";

export interface TelemetryStore {
  record(event: ToolExecutionEvent): void;
  get(id: string): ToolExecutionEvent | undefined;
  byTool(toolName: string): ToolExecutionEvent[];
  all(): ToolExecutionEvent[];
  clear(): void;
}

/**
 * In-memory telemetry store. Suitable for local runtimes, tests, and the
 * playground. Production deployments can swap in a persistent store implementing
 * the same interface.
 */
export class InMemoryTelemetryStore implements TelemetryStore {
  private events = new Map<string, ToolExecutionEvent>();

  record(event: ToolExecutionEvent): void {
    this.events.set(event.id, event);
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
