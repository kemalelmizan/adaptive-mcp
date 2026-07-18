import { describe, it, expect } from "vitest";
import { createToolEvent, isExtensionIdentifier, extensionIdentifier } from "@adaptivemcp/spec";

describe("@adaptivemcp/spec", () => {
  it("creates a tool event with defaults", () => {
    const e = createToolEvent({ toolName: "deploy_service" }, "completed");
    expect(e.toolName).toBe("deploy_service");
    expect(e.status).toBe("completed");
    expect(e.id).toMatch(/[0-9a-f-]{36}/);
    expect(() => new Date(e.timestamp).toISOString()).not.toThrow();
  });

  it("recognizes extension identifiers", () => {
    expect(isExtensionIdentifier(extensionIdentifier("telemetry"))).toBe(true);
    expect(isExtensionIdentifier("mcp://tools")).toBe(false);
  });
});
