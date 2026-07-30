import { AdaptiveRuntime } from "../runtime.js";
import { section } from "./shared.js";

/**
 * Scenario: Cost Optimization Analysis
 *
 * Demonstrates how the execution graph enables cost attribution and optimization:
 * - Build a workflow with varying tool costs
 * - Analyze cost breakdown per tool, per node, and critical path
 * - Identify high-cost tools for model routing optimization
 * - See workflow-level cost aggregation across multiple runs
 */
async function main(): Promise<void> {
  const runtime = new AdaptiveRuntime({ 
    yamlPath: "examples/yaml/cost-optimization.yaml",
    enableGraph: true 
  });

  section("Phase 1: Build a CI/CD workflow with varying costs");
  
  // Simulate multiple workflow runs with different cost profiles
  const workflowId = "ci_cd_pipeline";
  
  // Run 1: Normal run
  await runWorkflow(runtime, workflowId, "run-1", {
    github_checkout: { duration: 1500, cost: 0.0001 },
    npm_install: { duration: 45000, cost: 0.002 },
    npm_test: { duration: 120000, cost: 0.005 },
    docker_build: { duration: 180000, cost: 0.01 },
    docker_push: { duration: 30000, cost: 0.001 },
    deploy_staging: { duration: 60000, cost: 0.003 },
    integration_test: { duration: 90000, cost: 0.004 },
    deploy_prod: { duration: 45000, cost: 0.002 },
  });

  // Run 2: Slow test run (flaky tests)
  await runWorkflow(runtime, workflowId, "run-2", {
    github_checkout: { duration: 1500, cost: 0.0001 },
    npm_install: { duration: 45000, cost: 0.002 },
    npm_test: { duration: 300000, cost: 0.012 }, // 2.5x slower = more cost
    docker_build: { duration: 180000, cost: 0.01 },
    docker_push: { duration: 30000, cost: 0.001 },
    deploy_staging: { duration: 60000, cost: 0.003 },
    integration_test: { duration: 90000, cost: 0.004 },
    deploy_prod: { duration: 45000, cost: 0.002 },
  });

  // Run 3: Fast run (cached)
  await runWorkflow(runtime, workflowId, "run-3", {
    github_checkout: { duration: 500, cost: 0.00005 }, // cached
    npm_install: { duration: 5000, cost: 0.0002 }, // cached
    npm_test: { duration: 60000, cost: 0.0025 }, // fast
    docker_build: { duration: 30000, cost: 0.002 }, // cached layers
    docker_push: { duration: 15000, cost: 0.0005 },
    deploy_staging: { duration: 30000, cost: 0.0015 },
    integration_test: { duration: 45000, cost: 0.002 },
    deploy_prod: { duration: 20000, cost: 0.001 },
  });

  section("Phase 2: Cost Breakdown Analysis");
  
  // Get the latest session
  const sessions = runtime.memory.getNodesByWorkflow(workflowId);
  const sessionIds = [...new Set(sessions.map(n => n.sessionId))];
  const latestSession = sessionIds[sessionIds.length - 1] ?? "";
  
  const analysis = runtime.analyzeGraph(latestSession);
  
  console.log("\n--- Cost Breakdown (Latest Run) ---");
  console.log(`  Total: $${analysis.costBreakdown.totalCost.toFixed(4)}`);
  console.log(`  Critical Path: $${analysis.costBreakdown.criticalPathCost.toFixed(4)}`);
  console.log("\n  By Tool:");
  for (const [tool, cost] of Object.entries(analysis.costBreakdown.byTool)) {
    console.log(`    ${tool}: $${cost.toFixed(4)}`);
  }

  console.log("\n--- Bottlenecks (Cost-Aware) ---");
  for (const bottleneck of analysis.bottlenecks) {
    console.log(`  ${bottleneck.node.toolName}: impact=${bottleneck.impactScore.toFixed(1)} (${bottleneck.reason})`);
  }

  section("Phase 3: Workflow-Level Cost Statistics");
  
  const workflowStats = runtime.getWorkflowStats(workflowId);
  console.log(`  Total Executions: ${workflowStats.totalExecutions}`);
  console.log(`  Success Rate: ${(workflowStats.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg Duration: ${workflowStats.avgDurationMs.toFixed(0)}ms`);
  console.log(`  Avg Cost: $${workflowStats.avgCost.toFixed(4)}`);
  console.log(`  Cost Range: $${workflowStats.commonPatterns.map(p => p.avgDurationMs?.toFixed(4) ?? 'N/A').join(' - ')}`);

  section("Phase 4: Routing Recommendations (Cost-Based)");
  
  // Trigger routing analysis
  runtime.router.routeAll();
  
  const tools = ["npm_test", "docker_build", "integration_test", "deploy_prod"];
  for (const toolName of tools) {
    const tool = runtime.memory.getTool(toolName);
    if (tool) {
      const modelRecs = tool.recommendations.filter(r => r.type === "model");
      const routingRecs = tool.recommendations.filter(r => r.type === "routing");
      if (modelRecs.length > 0 || routingRecs.length > 0) {
        console.log(`\n${toolName}:`);
        for (const rec of [...modelRecs, ...routingRecs]) {
          console.log(`  - ${rec.type}: ${rec.payload} (${rec.rationale})`);
        }
      }
    }
  }

  section("Phase 5: Anomaly Detection");
  
  for (const sessionId of sessionIds) {
    const anomalies = runtime.graphAnalyzer.detectAnomalies(sessionId);
    if (anomalies.length > 0) {
      console.log(`\nSession ${sessionId}:`);
      for (const anomaly of anomalies) {
        console.log(`  [${anomaly.type}] ${anomaly.description}`);
      }
    }
  }

  section("Phase 6: Derived YAML View");
  console.log(runtime.extension.resourceText());

  runtime.close();
}

async function runWorkflow(
  runtime: AdaptiveRuntime,
  workflowId: string,
  sessionSuffix: string,
  steps: Record<string, { duration: number; cost: number }>
): Promise<void> {
  const sessionId = `${workflowId}-${sessionSuffix}`;
  let parentId: string | undefined;
  
  // Start workflow root
  const { nodeId: rootId } = runtime.startWorkflow({
    toolName: workflowId,
    serverName: "ci-cd",
    workflowId,
    model: "gpt-5",
    sessionId,
  });
  parentId = rootId;

  // Sequential pipeline steps
  for (const [toolName, { duration, cost }] of Object.entries(steps)) {
    const { nodeId } = runtime.startChild({
      toolName,
      serverName: "ci-cd",
      model: "gpt-5-mini",
    }, parentId);
    
    runtime.completeNode(nodeId, { 
      durationMs: duration, 
      cost: { amount: cost, currency: "USD" } 
    });
    
    parentId = nodeId;
  }

  // Complete root
  runtime.completeNode(rootId, { 
    durationMs: Object.values(steps).reduce((sum, s) => sum + s.duration, 0),
    cost: { amount: Object.values(steps).reduce((sum, s) => sum + s.cost, 0) }
  });
  
  // Evaluate after each run
  runtime.evaluator.evaluateAll();
  runtime.router.routeAll();
  runtime.orchestrator.planAll();
  runtime.extension.sync();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});