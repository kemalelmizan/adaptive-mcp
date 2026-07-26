import { AdaptiveRuntime } from "../runtime.js";
import { section } from "./shared.js";

/**
 * Scenario: Execution Graph Intelligence
 *
 * Demonstrates the distributed execution graph capabilities:
 * - Building a DAG from tool invocations
 * - Critical path analysis
 * - Bottleneck detection
 * - Fan-out/fan-in analysis
 * - Failure cascade analysis
 * - Cost breakdown per workflow
 * - Workflow pattern detection
 */
async function main(): Promise<void> {
  const runtime = new AdaptiveRuntime({ 
    yamlPath: "examples/yaml/execution-graph.yaml",
    enableGraph: true 
  });

  section("Phase 1: Build a deployment workflow graph");
  
  // Start the workflow root
  const { nodeId: rootId, sessionId } = runtime.startWorkflow({
    toolName: "deploy_release",
    serverName: "orchestrator",
    workflowId: "deploy_release",
    model: "gpt-5",
  });
  console.log(`Started workflow: deploy_release (session: ${sessionId}, root: ${rootId})`);

  // Parallel fan-out: merge PR and create release
  const { nodeId: mergePrId } = runtime.startChild({
    toolName: "github.merge_pr",
    serverName: "github",
    model: "gpt-5-mini",
  }, rootId);
  console.log(`  -> github.merge_pr (${mergePrId})`);

  const { nodeId: createReleaseId } = runtime.startChild({
    toolName: "github.create_release",
    serverName: "github",
    model: "gpt-5-mini",
  }, rootId);
  console.log(`  -> github.create_release (${createReleaseId})`);

  // Sequential chain: argocd.sync -> kubernetes.apply -> kubernetes.wait
  const { nodeId: argocdSyncId } = runtime.startChild({
    toolName: "argocd.sync",
    serverName: "argocd",
    model: "gpt-5",
  }, rootId);
  console.log(`  -> argocd.sync (${argocdSyncId})`);

  const { nodeId: k8sApplyId } = runtime.startChild({
    toolName: "kubernetes.apply",
    serverName: "kubernetes",
    model: "gpt-5",
  }, argocdSyncId);
  console.log(`     -> kubernetes.apply (${k8sApplyId})`);

  const { nodeId: k8sWaitId } = runtime.startChild({
    toolName: "kubernetes.wait",
    serverName: "kubernetes",
    model: "gpt-5-mini",
  }, k8sApplyId);
  console.log(`        -> kubernetes.wait (${k8sWaitId})`);

  // Notification (parallel to argocd chain)
  const { nodeId: notifyId } = runtime.startChild({
    toolName: "slack.notify",
    serverName: "slack",
    model: "gpt-5-mini",
  }, rootId);
  console.log(`  -> slack.notify (${notifyId})`);

  // Complete all nodes with simulated timings
  section("Phase 2: Complete nodes with realistic timings");
  
  runtime.completeNode(mergePrId, { durationMs: 2500, cost: { amount: 0.001 } });
  console.log(`  github.merge_pr completed in 2500ms`);
  
  runtime.completeNode(createReleaseId, { durationMs: 1800, cost: { amount: 0.001 } });
  console.log(`  github.create_release completed in 1800ms`);
  
  runtime.completeNode(argocdSyncId, { durationMs: 500, cost: { amount: 0.0005 } });
  console.log(`  argocd.sync completed in 500ms`);
  
  runtime.completeNode(k8sApplyId, { durationMs: 12000, cost: { amount: 0.002 } });
  console.log(`  kubernetes.apply completed in 12000ms (BOTTLENECK)`);
  
  runtime.completeNode(k8sWaitId, { durationMs: 8000, cost: { amount: 0.0005 } });
  console.log(`  kubernetes.wait completed in 8000ms`);
  
  runtime.completeNode(notifyId, { durationMs: 300, cost: { amount: 0.0001 } });
  console.log(`  slack.notify completed in 300ms`);
  
  runtime.completeNode(rootId, { durationMs: 25000, cost: { amount: 0.005 } });
  console.log(`  deploy_release (root) completed in 25000ms`);

  // Analyze the graph
  section("Phase 3: Graph Analysis");
  
  const analysis = runtime.analyzeGraph(sessionId);
  
  console.log("\n--- Critical Path ---");
  for (const node of analysis.criticalPath.path) {
    console.log(`  ${node.toolName}: ${node.durationMs}ms`);
  }
  console.log(`Total: ${analysis.criticalPath.totalDurationMs}ms`);

  console.log("\n--- Bottlenecks ---");
  for (const bottleneck of analysis.bottlenecks) {
    console.log(`  ${bottleneck.node.toolName}: impact=${bottleneck.impactScore.toFixed(1)} (${bottleneck.reason})`);
  }

  console.log("\n--- Fan-out Analysis ---");
  console.log(`  Max fan-out: ${analysis.fanOut.maxFanOut}`);
  console.log(`  Avg fan-out: ${analysis.fanOut.avgFanOut.toFixed(2)}`);
  console.log(`  Parallelizable nodes: ${analysis.fanOut.parallelizableNodes.map(n => n.toolName).join(", ")}`);
  console.log(`  Sequential chains: ${analysis.fanOut.sequentialChains.length}`);

  console.log("\n--- Failure Cascades ---");
  for (const cascade of analysis.failureCascades) {
    console.log(`  Root: ${cascade.rootCause.toolName} -> Blast radius: ${cascade.blastRadius} nodes`);
  }

  console.log("\n--- Cost Breakdown ---");
  console.log(`  Total: $${analysis.costBreakdown.totalCost.toFixed(4)}`);
  console.log(`  Critical path: $${analysis.costBreakdown.criticalPathCost.toFixed(4)}`);
  console.log(`  By tool:`, analysis.costBreakdown.byTool);

  console.log("\n--- Anomalies ---");
  for (const anomaly of analysis.anomalies) {
    console.log(`  [${anomaly.type}] ${anomaly.description}`);
  }

  // Workflow stats (would be more meaningful with multiple runs)
  section("Phase 4: Workflow Statistics");
  const workflowStats = runtime.getWorkflowStats("deploy_release");
  console.log(`  Executions: ${workflowStats.totalExecutions}`);
  console.log(`  Success rate: ${(workflowStats.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg duration: ${workflowStats.avgDurationMs.toFixed(0)}ms`);
  console.log(`  Avg cost: $${workflowStats.avgCost.toFixed(4)}`);
  console.log(`  Patterns:`, workflowStats.commonPatterns);

  // Show the derived YAML view
  section("Phase 5: Derived YAML View (tools-metadata.yaml)");
  console.log(runtime.extension.resourceText());

  runtime.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});