/**
 * Backend lifecycle: start a model server on demand, stop it when idle.
 *
 * The proxy is the only thing that knows a backend is about to be used, which makes
 * it the right place to own the process. A local model can hold gigabytes of RAM (or
 * the whole GPU), so leaving it resident for the one request a day that needs it is
 * waste — and cold-booting is acceptable, so "load on first use, unload when idle" is
 * the whole policy.
 *
 * Three rules keep this from becoming a process babysitter:
 *
 * 1. **Only manage what you start.** A backend that already answers was started by
 *    someone else (or a previous proxy) and is never killed by this one.
 * 2. **One start at a time.** Concurrent requests share a single start promise, so a
 *    burst cannot spawn three servers on one port.
 * 3. **Never leave a child behind.** The server is spawned in its own process group
 *    and killed by group, which also takes the worker threads it forked.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { BackendConfig, ManageSpec } from "./config.js";

export type BackendState = "stopped" | "starting" | "running" | "external";

export interface LifecycleStatus {
  name: string;
  state: BackendState;
  /** Whether the process was started by this proxy (and so may be stopped by it). */
  owned: boolean;
  pid?: number;
  lastUsedAt?: string;
  /** The tail of the child's stderr, for diagnosing a failed start. */
  error?: string;
}

export interface LifecycleDeps {
  /** Injected in tests. */
  spawnProcess?: typeof spawn;
  /** Whether the backend is answering right now. Defaults to an HTTP probe. */
  probe?: (baseURL: string, readyPath: string) => Promise<boolean>;
  now?: () => number;
  /** How often to poll readiness while starting (default 500ms). */
  pollMs?: number;
  /** How long to wait for a stop before SIGKILL (default 10s). */
  stopGraceMs?: number;
}

const DEFAULT_READY_PATH = "/health";
const DEFAULT_START_TIMEOUT_MS = 180_000;
const DEFAULT_IDLE_TIMEOUT_MS = 600_000;

/** An HTTP status below 500 means the server is listening; llama.cpp answers 503 while loading. */
async function httpProbe(baseURL: string, readyPath: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseURL}${readyPath}`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** The child's environment: the proxy's, with `manage.env` applied (`null` removes). */
function childEnv(spec: ManageSpec): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  return env;
}
/** `http://host:port/v1` → `http://host:port`; leave anything unparseable alone. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export class BackendLifecycle {
  private readonly spec: ManageSpec;
  private readonly deps: LifecycleDeps;
  private readonly baseURL: string;
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private lastUsed = 0;
  private stderr = "";
  private external = false;

  constructor(
    readonly name: string,
    backend: BackendConfig,
    deps: LifecycleDeps = {},
  ) {
    if (!backend.manage) throw new Error(`backend "${name}" has no manage spec`);
    this.spec = backend.manage;
    // Readiness is a property of the *server*, not of the API prefix: `/health`
    // lives at the origin, and probing `<baseURL>/health` would ask `/v1/health`
    // and take a 404 for readiness.
    this.baseURL = backend.manage.baseURL ?? originOf(backend.baseURL);
    this.deps = deps;
  }

  private get now(): () => number {
    return this.deps.now ?? Date.now;
  }

  private get idleTimeoutMs(): number {
    return this.spec.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  status(): LifecycleStatus {
    return {
      name: this.name,
      state: this.starting ? "starting" : this.child ? "running" : this.external ? "external" : "stopped",
      owned: this.child !== undefined,
      pid: this.child?.pid,
      lastUsedAt: this.lastUsed ? new Date(this.lastUsed).toISOString() : undefined,
      error: this.stderr.trim() ? this.stderr.trim().split("\n").slice(-3).join("\n") : undefined,
    };
  }

  /** Mark the backend as just used, so the idle sweep leaves it alone. */
  touch(): void {
    this.lastUsed = this.now();
  }

  /** Whether the backend answers right now, regardless of who started it. */
  async reachable(): Promise<boolean> {
    return this.answering();
  }

  /**
   * Make sure the backend is answerable, starting it if this proxy may.
   * Rejects when a managed start fails, so the caller can fall back.
   */
  async ensureRunning(): Promise<void> {
    if (await this.answering()) {
      this.external = !this.child;
      this.touch();
      return;
    }
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  /** Stop the backend if this proxy started it and it has been idle long enough. */
  async sweep(): Promise<void> {
    if (!this.child || this.idleTimeoutMs <= 0) return;
    if (this.now() - this.lastUsed < this.idleTimeoutMs) return;
    await this.stop();
  }

  /** Stop the child this proxy owns (a no-op for one it does not). */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      this.child = undefined;
      return;
    }
    this.child = undefined;
    await this.terminate(child);
  }

  /** Always stop on shutdown, regardless of idle time. */
  async close(): Promise<void> {
    await this.stop();
  }

  private async answering(): Promise<boolean> {
    const probe = this.deps.probe ?? httpProbe;
    return probe(this.baseURL, this.spec.readyPath ?? DEFAULT_READY_PATH);
  }

  private async start(): Promise<void> {
    const spec = this.spec;
    this.stderr = "";
    const spawnProcess = this.deps.spawnProcess ?? spawn;
    const child = spawnProcess(spec.command, spec.args ?? [], {
      env: childEnv(spec),
      // Own process group: killing the group takes forked workers with it.
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.child = child;
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4_000);
    });

    const timeoutMs = spec.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    const deadline = this.now() + timeoutMs;
    const pollMs = this.deps.pollMs ?? 500;
    const probe = this.deps.probe ?? httpProbe;

    for (;;) {
      if (child.exitCode !== null) {
        this.child = undefined;
        throw new Error(
          `backend "${this.name}" exited during startup` +
            (this.stderr.trim() ? `: ${this.tail()}` : ""),
        );
      }
      if (await probe(this.baseURL, spec.readyPath ?? DEFAULT_READY_PATH)) {
        this.touch();
        return;
      }
      if (this.now() >= deadline) {
        await this.stop();
        throw new Error(
          `backend "${this.name}" did not become ready within ${timeoutMs}ms` +
            (this.stderr.trim() ? `: ${this.tail()}` : ""),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  private tail(): string {
    return this.stderr.trim().split("\n").slice(-3).join(" | ");
  }

  private async terminate(child: ChildProcess): Promise<void> {
    const grace = this.deps.stopGraceMs ?? 10_000;
    const pid = child.pid;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (pid !== undefined) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    const timer = setTimeout(() => {
      if (pid !== undefined) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, grace);
    timer.unref?.();
    await exited;
    clearTimeout(timer);
  }
}
