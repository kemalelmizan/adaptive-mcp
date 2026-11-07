import { describe, expect, it } from "vitest";
import { isExpectedBumpFile, packageVersion, qualify, stdoutOf } from "./workspace.ts";

describe("release script plumbing", () => {
  it("reads stdout from either promisified execFile shape", () => {
    // The regression: on Node 26 `promisify(execFile)` resolves to the raw string, so
    // reading `.stdout` returned undefined, `isPublished()` said "not published" for
    // versions that were on npm, and a release published everything then refused to tag.
    expect(stdoutOf("0.7.0\n")).toBe("0.7.0\n");
    expect(stdoutOf({ stdout: "0.7.0\n" })).toBe("0.7.0\n");
  });

  it("recognises the files a version bump is allowed to touch", () => {
    expect(isExpectedBumpFile("package.json")).toBe(true);
    expect(isExpectedBumpFile("CHANGELOG.md")).toBe(true);
    expect(isExpectedBumpFile("packages/spec/package.json")).toBe(true);
    expect(isExpectedBumpFile("packages/spec/CHANGELOG.md")).toBe(true);
    expect(isExpectedBumpFile(".changeset/context-edges.md")).toBe(true);

    // Anything else in the tree means the release would commit unrelated work.
    expect(isExpectedBumpFile("packages/spec/src/index.ts")).toBe(false);
    expect(isExpectedBumpFile("scripts/release.ts")).toBe(false);
    expect(isExpectedBumpFile("README.md")).toBe(false);
  });

  it("reads a package version from the workspace, not from the registry", () => {
    // Pins the path convention: `@adaptivemcp/spec` lives in `packages/spec`.
    expect(packageVersion("@adaptivemcp/spec")).toMatch(/^\d+\.\d+\.\d+/);
    expect(packageVersion("spec")).toBe(packageVersion("@adaptivemcp/spec"));
  });

  it("qualifies a bare package name before asking the registry", () => {
    // `spec` is a different, real package on npm, so the bare form must be scoped.
    expect(qualify("spec")).toBe("@adaptivemcp/spec");
    expect(qualify("@adaptivemcp/spec")).toBe("@adaptivemcp/spec");
  });
});
