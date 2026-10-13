import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { ToolExecutionEvent } from "@adaptivemcp/spec";
import { MemoryStore } from "./store.js";

/**
 * Invariants of the metric-cell fold. The store deliberately keeps no events
 * table (see docs/doubts.md §15), so these counters *are* the durable record;
 * a fold bug silently corrupts every derived signal. Property-based tests pin
 * the arithmetic that hand-written cases only sample.
 */

interface Spec {
  toolName: string;
  serverName: string;
  status: "completed" | "failed";
  durationMs?: number;
  model?: string;
  attempts?: number;
  costAmount?: number;
}

const spec: fc.Arbitrary<Spec> = fc.record({
  toolName: fc.constantFrom("alpha", "beta"),
  serverName: fc.constantFrom("s1", "s2"),
  status: fc.constantFrom<"completed" | "failed">("completed", "failed"),
  durationMs: fc.option(fc.integer({ min: 0, max: 20000 }), { nil: undefined }),
  model: fc.option(fc.constantFrom("m1", "m2", "m3"), { nil: undefined }),
  attempts: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
  costAmount: fc.option(fc.integer({ min: 0, max: 1000 }).map((n) => n / 100), { nil: undefined }),
});

function materialize(specs: Spec[]): ToolExecutionEvent[] {
  return specs.map((s, index) => {
    const event: ToolExecutionEvent = {
      id: `e${index}`,
      toolName: s.toolName,
      serverName: s.serverName,
      timestamp: `2026-09-29T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
      status: s.status,
    };
    if (s.durationMs !== undefined) event.durationMs = s.durationMs;
    if (s.model !== undefined) event.model = s.model;
    if (s.attempts !== undefined) event.attempts = s.attempts;
    if (s.costAmount !== undefined) event.cost = { amount: s.costAmount, currency: "USD" };
    return event;
  });
}

function overall(cells: ReturnType<MemoryStore["metricCells"]>) {
  return cells.filter((c) => c.window === "all" && Object.keys(c.dimensions).length === 0);
}

describe("metric-cell fold (property)", () => {
  it("keeps the lifetime cell consistent with its dimensional cells", () => {
    fc.assert(
      fc.property(fc.array(spec, { maxLength: 40 }), (specs) => {
        const events = materialize(specs);
        const store = new MemoryStore({ path: ":memory:" });
        try {
          for (const event of events) store.recordExecution(event);

          const cells = store.metricCells();
          // One overall cell per (tool, server).
          const groups = new Map<string, ToolExecutionEvent[]>();
          for (const event of events) {
            const key = `${event.toolName}\u0000${event.serverName ?? ""}`;
            groups.set(key, [...(groups.get(key) ?? []), event]);
          }
          const overallCells = overall(cells);
          expect(overallCells).toHaveLength(groups.size);

          for (const group of groups.values()) {
            const cell = overallCells.find(
              (c) =>
                c.toolName === group[0]!.toolName && c.serverName === group[0]!.serverName,
            );
            expect(cell).toBeDefined();
            if (!cell) continue;

            expect(cell.invocations).toBe(group.length);
            expect(cell.failures).toBe(group.filter((e) => e.status === "failed").length);
            expect(cell.attempts).toBe(group.reduce((sum, e) => sum + (e.attempts ?? 1), 0));
            const withDuration = group.filter((e) => e.durationMs !== undefined);
            expect(cell.durationCount).toBe(withDuration.length);
            expect(cell.durationSum).toBe(
              group.reduce((sum, e) => sum + (e.durationMs ?? 0), 0),
            );
            expect(cell.durationHistogram.reduce((a, b) => a + b, 0)).toBe(cell.durationCount);

            // No model collapse with <= 3 distinct models: the model cells must
            // partition the events that carried a model.
            const withModel = group.filter((e) => e.model !== undefined).length;
            const modelInvocations = cells
              .filter(
                (c) =>
                  c.window === "all" &&
                  c.dimensions.model !== undefined &&
                  c.toolName === cell.toolName &&
                  c.serverName === cell.serverName,
              )
              .reduce((sum, c) => sum + c.invocations, 0);
            expect(modelInvocations).toBe(withModel);
          }

          // Reading is deterministic.
          expect(store.metricCells()).toEqual(cells);
        } finally {
          store.close();
        }
      }),
    );
  });

  it("counters only ever increase as events are folded", () => {
    fc.assert(
      fc.property(fc.array(spec, { minLength: 1, maxLength: 30 }), (specs) => {
        const events = materialize(specs);
        const store = new MemoryStore({ path: ":memory:" });
        try {
          const seen = new Map<string, number>();
          for (const event of events) {
            store.recordExecution(event);
            const key = `${event.toolName}\u0000${event.serverName ?? ""}`;
            const cell = overall(
              store.metricCells({ toolName: event.toolName, serverName: event.serverName }),
            )[0];
            expect(cell).toBeDefined();
            expect(cell!.invocations).toBe((seen.get(key) ?? 0) + 1);
            seen.set(key, cell!.invocations);
          }
        } finally {
          store.close();
        }
      }),
    );
  });
});
