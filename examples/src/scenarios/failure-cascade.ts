import { AdaptiveRuntime } from "../runtime.js";
import { section } from "./shared.js";

/**
 * Scenario: Failure Cascade Analysis
 *
 * Demonstrates how failures propagate through the execution graph:
 * - Build a deployment workflow graph
 * - Simulate a failure in kubernetes.apply
 * - Observe failure blast radius and cascade analysis
 * - See how approval recommendations are triggered for upstream nodes
 */
async function main(): Promise<void> {
  const runtime = new AdaptiveRuntime({ 
    yamlPath: "examples/yaml/failure-cascade.yaml",
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

  // Complete all nodes - but make kubernetes.apply FAIL
  section("Phase 2: Complete nodes with kubernetes.apply FAILING");
  
  runtime.completeNode(mergePrId, { durationMs: 2500, cost: { amount: 0.001 } });
  console.log(`  github.merge_pr completed in 2500ms`);
  
  runtime.completeNode(createReleaseId, { durationMs: 1800, cost: { amount: 0.001 } });
  console.log(`  github.create_release completed in 1800ms`);
  
  runtime.completeNode(argocdSyncId, { durationMs: 500, cost: { amount: 0.0005 } });
  console.log(`  argocd.sync completed in 500ms`);
  
  // THIS ONE FAILS
  runtime.failNode(k8sApplyId, { message: "Cluster unreachable: connection timeout", code: "CLUSTER_UNREACHABLE" });
  console.log(`  kubernetes.apply FAILED: Cluster unreachable`);
  
  // kubernetes.wait never runs (or fails too)
  runtime.failNode(k8sWaitId, { message: "Previous step failed", code: "DEPENDENCY_FAILED" });
  console.log(`  kubernetes.wait FAILED: Dependency failed`);
  
  runtime.completeNode(notifyId, { durationMs: 300, cost: { amount: 0.0001 } });
  console.log(`  slack.notify completed in 300ms`);
  
  // Root completes but with failure status
  runtime.failNode(rootId, { message: "Deployment failed due to kubernetes.apply failure", code: "DEPLOYMENT_FAILED" });
  console.log(`  deploy_release (root) FAILED`);

  // Analyze the graph
  section("Phase 3: Failure Cascade Analysis");
  
  const analysis = runtime.analyzeGraph(sessionId);
  
  console.log("\n--- Critical Path ---");
  for (const node of analysis.criticalPath.path) {
    console.log(`  ${node.toolName}: ${node.durationMs}ms (${node.status})`);
  }
  console.log(`Total: ${analysis.criticalPath.totalDurationMs}ms`);

  console.log("\n--- Failure Cascades ---");
  for (const cascade of analysis.failureCascades) {
    console.log(`  Root cause: ${cascade.rootCause.toolName} (${cascade.rootCause.error?.message})`);
    console.log(`  Blast radius: ${cascade.blastRadius} nodes affected`);
    for (const affected of cascade.affectedNodes) {
      console.log(`    -> ${affected.toolName}: ${affected.status} (${affected.error?.message})`);
    }
  }

  console.log("\n--- Bottlenecks ---");
  for (const bottleneck of analysis.bottlenecks) {
    console.log(`  ${bottleneck.node.toolName}: impact=${bottleneck.impactScore.toFixed(1)} (${bottleneck.reason})`);
  }

  // Check if approval recommendations were triggered
  section("Phase 4: Approval Gate Impact");
  
  // The failure should trigger approval recommendations for upstream tools
  const argocdTool = runtime.memory.getTool("argocd.sync");
  const k8sApplyTool = runtime.memory.getTool("kubernetes.apply");
  const k8sWaitTool = runtime.memory.getTool("kubernetes.wait");
  
  console.log("\nargocd.sync recommendations:");
  for (const rec of argocdTool?.recommendations ?? []) {
    console.log(`  - ${rec.type}: ${rec.rationale}`);
  }
  
  console.log("\nkubernetes.apply recommendations:");
  for (const rec of k8sApplyTool?.recommendations ?? []) {
    console.log(`  - ${rec.type}: ${rec.rationale}`);
  }
  
  console.log("\nkubernetes.wait recommendations:");
  for (const rec of k8sWaitTool?.recommendations ?? []) {
    console.log(`  - ${rec.type}: ${rec.rationale}`);
  }

  // Workflow stats
  section("Phase 5: Workflow Statistics");
  const workflowStats = runtime.getWorkflowStats("deploy_release");
  console.log(`  Executions: ${workflowStats.totalExecutions}`);
  console.log(`  Success rate: ${(workflowStats.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg duration: ${workflowStats.avgDurationMs.toFixed(0)}ms`);
  console.log(`  Avg cost: $${workflowStats.avgCost.toFixed(4)}`);

  // Show the derived YAML view
  section("Phase 6: Derived YAML View (tools-metadata.yaml)");
  console.log(runtime.extension.resourceText());

  runtime.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});