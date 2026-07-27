import { AdaptiveRuntime } from "../runtime.js";
import { section } from "./shared.js";

/**
 * `runtime.failNode` (via `TelemetryRecorder.failNode`) never sets
 * `durationMs` — only `completeNode` does. `detectAntiPatterns`'s
 * sequential_bottleneck check is duration-ratio-based, so a failed node
 * needs a duration on it to participate meaningfully; patch it in directly
 * via the store (`recordExecutionNode` upserts) rather than extending the
 * shared telemetry API just for this scenario.
 */
function failWithDuration(
  runtime: AdaptiveRuntime,
  nodeId: string,
  durationMs: number,
  error: { message: string; code?: string },
): void {
  runtime.failNode(nodeId, error);
  const node = runtime.memory.getExecutionNode(nodeId);
  if (node) runtime.memory.recordExecutionNode({ ...node, durationMs });
}

/**
 * Scenario: Debugging a Failed Deployment
 *
 * Walks through the Phase 10/12 graph-inspection tools that no other
 * scenario exercises — `execution-graph.ts`/`failure-cascade.ts` already
 * cover critical path / blast radius / bottlenecks on a near-identical
 * topology, so this one leans on:
 * - Causal cascade analysis: root causes vs. downstream symptoms across TWO
 *   independent failure chains (not just one linear failure)
 * - Anti-pattern detection: the sequential apply -> wait -> rollback chain
 * - Workflow forecasting: was this failure/duration an outlier given history?
 * - Visual exports: Mermaid and GraphViz DOT diagrams of the failed graph
 */
async function main(): Promise<void> {
  const runtime = new AdaptiveRuntime({
    yamlPath: "examples/yaml/debugging-deployment.yaml",
    enableGraph: true,
  });

  section("Phase 1: Seed 3 prior successful deploy_release runs (history for forecasting)");

  for (let i = 0; i < 3; i++) {
    const { nodeId: rootId } = runtime.startWorkflow({
      toolName: "deploy_release",
      serverName: "orchestrator",
      workflowId: "deploy_release",
      model: "gpt-5",
    });
    const { nodeId: applyId } = runtime.startChild({ toolName: "kubernetes.apply", serverName: "kubernetes" }, rootId);
    runtime.completeNode(applyId, { durationMs: 4000 + i * 200, cost: { amount: 0.002 } });
    runtime.completeNode(rootId, { durationMs: 6000 + i * 300, cost: { amount: 0.004 } });
    console.log(`  Historical run ${i + 1}: deploy_release completed in ${6000 + i * 300}ms`);
  }

  section("Phase 2: Build the failing deployment — two independent failure chains");

  // `deploy_release` has exactly one child (kubernetes.apply) so the
  // apply -> wait -> rollback chain qualifies as a *sequential chain* for
  // `detectAntiPatterns` (its sequential_bottleneck detector only recognizes
  // chains that start at a session root with fan-out 1 — see Phase 5 below).
  // `slack.notify` is deliberately a second, independent root in the same
  // session (no shared parent with the k8s chain), so it's a genuinely
  // separate root cause rather than a sibling of it.
  const { nodeId: rootId, sessionId } = runtime.startWorkflow({
    toolName: "deploy_release",
    serverName: "orchestrator",
    workflowId: "deploy_release",
    model: "gpt-5",
  });
  console.log(`Started workflow: deploy_release (session: ${sessionId}, root: ${rootId})`);

  const { nodeId: applyId } = runtime.startChild({ toolName: "kubernetes.apply", serverName: "kubernetes" }, rootId);
  console.log(`  -> kubernetes.apply (${applyId})`);
  const { nodeId: waitId } = runtime.startChild({ toolName: "kubernetes.wait", serverName: "kubernetes" }, applyId);
  console.log(`     -> kubernetes.wait (${waitId})`);
  const { nodeId: rollbackId } = runtime.startChild({ toolName: "kubernetes.rollback", serverName: "kubernetes" }, waitId);
  console.log(`        -> kubernetes.rollback (${rollbackId})`);

  // Reuses `sessionId` explicitly so this becomes a second, parentless root
  // in the *same* session (see comment above) rather than starting a new one.
  const { nodeId: notifyId } = runtime.startWorkflow({
    toolName: "slack.notify",
    serverName: "slack",
    workflowId: "deploy_release",
    sessionId,
  });
  console.log(`  -> slack.notify (${notifyId}), a second independent root in the same session`);

  section("Phase 3: Complete/fail nodes");

  failWithDuration(runtime, applyId, 3000, { message: "Cluster unreachable: connection timeout", code: "CLUSTER_UNREACHABLE" });
  console.log(`  kubernetes.apply FAILED after 3000ms: Cluster unreachable`);
  failWithDuration(runtime, waitId, 2000, { message: "Dependency failed", code: "DEPENDENCY_FAILED" });
  console.log(`  kubernetes.wait FAILED after 2000ms: Dependency failed`);
  failWithDuration(runtime, rollbackId, 1500, { message: "Dependency failed", code: "DEPENDENCY_FAILED" });
  console.log(`  kubernetes.rollback FAILED after 1500ms: Dependency failed`);
  failWithDuration(runtime, notifyId, 200, { message: "Slack API rate limited", code: "RATE_LIMITED" });
  console.log(`  slack.notify FAILED after 200ms: Slack API rate limited (independent of the k8s chain)`);
  // `deploy_release` itself is deliberately left "started" rather than
  // failed: the causal-cascade algorithm treats a failed *root* (no parent)
  // as its own root cause, which would blur the "two independent root
  // causes" narrative below — a workflow that never reaches its own
  // completion because a step failed is an accurate representation anyway.
  console.log(`  deploy_release (root) never completes — a downstream step failed`);

  section("Phase 4: Causal Cascade — root causes vs. downstream symptoms");

  const causal = runtime.graphAnalyzer.getCausalCascade(sessionId);
  console.log("\n--- Root Causes (no failed ancestor) ---");
  for (const cause of causal.rootCauses) {
    console.log(`  ${cause.toolName}: ${cause.error?.message}`);
  }
  console.log("\n--- Symptoms (downstream of a root cause) ---");
  for (const symptom of causal.symptoms) {
    console.log(`  ${symptom.node.toolName} <- caused by ${symptom.causedBy.toolName}`);
  }
  console.log(`\nBlast radius (descendants of root causes): ${causal.blastRadius} nodes`);

  section("Phase 5: Anti-Pattern Detection");

  const antiPatterns = runtime.graphAnalyzer.detectAntiPatterns(sessionId);
  if (antiPatterns.length === 0) {
    console.log("  No anti-patterns detected.");
  }
  for (const pattern of antiPatterns) {
    console.log(`  [${pattern.type}] severity=${pattern.severity.toFixed(2)}: ${pattern.nodes.map((n) => n.toolName).join(" -> ")}`);
  }

  section("Phase 6: Workflow Forecast — was this predictable given history?");

  const forecast = runtime.graphAnalyzer.getWorkflowForecast(sessionId, "deploy_release");
  console.log(`  Progress ratio: ${(forecast.progressRatio * 100).toFixed(0)}%`);
  console.log(`  Projected duration: ${forecast.projectedDurationMs.toFixed(0)}ms`);
  console.log(`  Projected cost: $${forecast.projectedCost.toFixed(4)}`);
  console.log(`  Failure probability: ${(forecast.failureProbability * 100).toFixed(0)}%`);

  section("Phase 7: Visual Debugging — Mermaid + GraphViz DOT");

  console.log("\n--- Mermaid ---\n");
  console.log(runtime.extension.executionGraphMermaidResourceText(sessionId));
  console.log("\n--- GraphViz DOT ---\n");
  console.log(runtime.extension.executionGraphDotResourceText(sessionId));

  runtime.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
