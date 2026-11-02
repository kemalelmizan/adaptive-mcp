import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { BackendLifecycle } from "./lifecycle.js";

/** A stand-in child: records kills, and can exit on demand. */
function fakeChild(pid = 4321) {
  const emitter = new EventEmitter();
  const child = {
    pid,
    exitCode: null as number | null,
    stderr: new EventEmitter(),
    once(event: string, listener: () => void) {
      emitter.once(event, listener);
      return child as unknown as ChildProcess;
    },
    kill() {
      child.exitCode = 0;
      emitter.emit("exit");
      return true;
    },
    /** Simulate the process dying on its own. */
    exitOn(stream: string, text: string) {
      (child.stderr as EventEmitter).emit("data", Buffer.from(text));
      child.exitCode = 1;
      emitter.emit("exit");
    },
  };
  return child;
}

function backend(manage: Record<string, unknown> = {}) {
  return {
    baseURL: "http://127.0.0.1:9999/v1",
    model: "m",
    manage: {
      command: "llama-server",
      args: ["-m", "model.gguf"],
      readyPath: "/health",
      ...manage,
    },
  };
}

describe("backend lifecycle", () => {
  it("borrows a backend that already answers, and never claims it", async () => {
    let spawned = 0;
    const lifecycle = new BackendLifecycle("coder", backend(), {
      probe: async () => true,
      spawnProcess: (() => {
        spawned += 1;
        return fakeChild();
      }) as never,
    });

    await lifecycle.ensureRunning();

    expect(spawned).toBe(0);
    expect(lifecycle.status()).toMatchObject({ state: "external", owned: false });
  });

  it("starts a cold backend, then reports it as owned", async () => {
    let ready = false;
    const child = fakeChild();
    const lifecycle = new BackendLifecycle("fast", backend(), {
      probe: async () => ready,
      spawnProcess: (() => child) as never,
      pollMs: 1,
    });

    const started = lifecycle.ensureRunning();
    ready = true;
    await started;

    expect(lifecycle.status()).toMatchObject({ state: "running", owned: true, pid: 4321 });
  });

  it("shares one start between concurrent requests", async () => {
    let spawned = 0;
    let ready = false;
    const lifecycle = new BackendLifecycle("fast", backend(), {
      probe: async () => ready,
      spawnProcess: (() => {
        spawned += 1;
        return fakeChild(spawned);
      }) as never,
      pollMs: 1,
    });

    const both = Promise.all([lifecycle.ensureRunning(), lifecycle.ensureRunning()]);
    ready = true;
    await both;

    expect(spawned).toBe(1);
  });

  it("reports why a backend died during startup", async () => {
    const child = fakeChild();
    const lifecycle = new BackendLifecycle("fast", backend(), {
      probe: async () => false,
      spawnProcess: (() => child) as never,
      pollMs: 1,
    });

    const started = lifecycle.ensureRunning();
    // Let the spawn (and the stderr listener) happen before the child dies.
    await new Promise((resolve) => setTimeout(resolve, 5));
    child.exitOn("stderr", "CUDA error: device busy");
    await expect(started).rejects.toThrow(/exited during startup.*CUDA error/s);
    expect(lifecycle.status().owned).toBe(false);
  });

  it("gives up on a start that never becomes ready, and reaps it", async () => {
    const child = fakeChild();
    const lifecycle = new BackendLifecycle("fast", backend({ startTimeoutMs: 20 }), {
      probe: async () => false,
      spawnProcess: (() => child) as never,
      pollMs: 5,
    });

    await expect(lifecycle.ensureRunning()).rejects.toThrow(/did not become ready/);
    expect(child.exitCode).toBe(0);
  });

  it("stops an owned backend only after it has been idle long enough", async () => {
    let now = 1_000;
    let ready = false;
    const child = fakeChild();
    const lifecycle = new BackendLifecycle("fast", backend({ idleTimeoutMs: 100 }), {
      probe: async () => ready,
      spawnProcess: (() => child) as never,
      pollMs: 1,
      now: () => now,
    });

    const started = lifecycle.ensureRunning();
    ready = true;
    await started;
    expect(lifecycle.status().owned).toBe(true);

    now += 50;
    await lifecycle.sweep();
    expect(child.exitCode).toBeNull(); // still warm

    now += 100;
    await lifecycle.sweep();
    expect(child.exitCode).toBe(0);
    expect(lifecycle.status().owned).toBe(false);
  });

  it("never stops a backend it did not start", async () => {
    const lifecycle = new BackendLifecycle("coder", backend({ idleTimeoutMs: 1 }), {
      probe: async () => true,
    });

    await lifecycle.ensureRunning();
    await lifecycle.sweep();
    await lifecycle.close();

    expect(lifecycle.status().state).toBe("external");
  });

  it("unsets an inherited variable when the spec says null", async () => {
    const child = fakeChild();
    let spawnedEnv: NodeJS.ProcessEnv | undefined;
    const lifecycle = new BackendLifecycle("fast", backend({ env: { DO_NOT_INHERIT: null } }), {
      probe: async () => false,
      spawnProcess: ((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
        spawnedEnv = options.env;
        return child;
      }) as never,
      pollMs: 1,
    });

    const started = lifecycle.ensureRunning();
    await new Promise((resolve) => setTimeout(resolve, 5));
    child.exitOn("stderr", "done");
    await expect(started).rejects.toThrow(/exited during startup/);

    // A stray key in the proxy's own environment must not reach a model server
    // that would then demand auth the host never sends.
    expect(spawnedEnv).toBeDefined();
    expect("DO_NOT_INHERIT" in (spawnedEnv as NodeJS.ProcessEnv)).toBe(false);
    expect(spawnedEnv?.PATH).toBe(process.env.PATH);
  });

  it("keeps a backend running when idleTimeoutMs is zero", async () => {
    let now = 1_000;
    let ready = false;
    const child = fakeChild();
    const lifecycle = new BackendLifecycle("fast", backend({ idleTimeoutMs: 0 }), {
      probe: async () => ready,
      spawnProcess: (() => child) as never,
      pollMs: 1,
      now: () => now,
    });

    const started = lifecycle.ensureRunning();
    ready = true;
    await started;

    now += 10_000_000;
    await lifecycle.sweep();

    expect(child.exitCode).toBeNull();
  });
});
