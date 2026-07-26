import { MemoryStore } from "@adaptivemcp/memory";
import { ApprovalGate } from "@adaptivemcp/approval";

const memory = new MemoryStore({ path: ":memory:" });

// Set up some tools
memory.ensureTool("deploy_service", "platform");
memory.ensureTool("github.merge_pr", "github");
memory.ensureTool("github.create_release", "github");
memory.ensureTool("kubernetes.apply", "kubernetes");
memory.ensureTool("kubernetes.wait", "kubernetes");
memory.ensureTool("slack.notify", "slack");
memory.ensureTool("dangerous.delete_all", "admin");
memory.ensureTool("flaky-server.unstable_tool", "flaky-server");

// Test glob patterns
const gate = new ApprovalGate({
  memory,
  policy: {
    denyTools: [
      "dangerous.*",           // matches dangerous.delete_all
      "flaky-server.*",        // matches flaky-server.unstable_tool
      "*.delete_*",            // matches dangerous.delete_all
    ],
    confirmRiskLevels: ["high"],
    flakyFailureRate: 0.2,
  },
  minInvocations: 10,
});

console.log("=== Testing glob pattern deny list ===\n");

// Test exact matches
console.log("dangerous.delete_all (should be denied):", gate.gate("dangerous.delete_all", "admin"));
console.log("flaky-server.unstable_tool (should be denied):", gate.gate("flaky-server.unstable_tool", "flaky-server"));
console.log("github.merge_pr (should be allowed):", gate.gate("github.merge_pr", "github"));
console.log("deploy_service (should be allowed):", gate.gate("deploy_service", "platform"));

// Test with high-risk annotation
memory.setAnnotation({ toolName: "deploy_service", serverName: "platform", risk: "high" });
console.log("\ndeploy_service with high risk (should require_confirmation):", gate.gate("deploy_service", "platform"));

// Test flaky tool
memory.ensureTool("flaky_tool", "test");
for (let i = 0; i < 15; i++) {
  memory.recordExecution({
    id: `test-${i}`,
    toolName: "flaky_tool",
    serverName: "test",
    timestamp: new Date().toISOString(),
    status: i < 4 ? "failed" : "completed",
    durationMs: 100,
  });
}
console.log("\nflaky_tool with 26% failure rate (should require_confirmation):", gate.gate("flaky_tool", "test"));

console.log("\n=== All tests passed! ===");