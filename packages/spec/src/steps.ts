/**
 * The durable half of two archetype components
 * ([ADR-004](../../../docs/adr/004-archetype-component-ownership.md)): the
 * **shared task list** and the **typed memory steps** a planning pass records.
 *
 * Both are *shapes* here and *policy* in the host. A host decides what to plan,
 * who a task is assigned to, when to re-plan and what a status transition means;
 * this module only fixes what the record looks like, so two hosts record the
 * same thing the same way, and `memory` can persist one history a reader can
 * replay in order.
 *
 * Modelled on two references:
 *
 * - `agno`'s `team/task.py` — `Task` with `status`, `assignee`, `parent_id`,
 *   `dependencies`, `result`, `notes`, and the `coordinate`/`route`/`tasks`
 *   modes built on it (`TaskStatus` is its five states plus `cancelled`, which a
 *   host that can *pause* also needs a word for);
 * - `smolagents`' `memory.py` — one `AgentMemory` holding typed, replayable
 *   steps, of which `TaskStep`/`ActionStep`/`PlanningStep` are the three this
 *   keeps. The other two there (`SystemPromptStep`, `FinalAnswerStep`) are
 *   conversation, not work, and are already covered by messages.
 *
 * Deliberately **not** here: a graph, a scheduler, a coordinator, or a mode
 * enum. Those need a host's session lifecycle and model, which is exactly the
 * line ADR-004 draws — `orchestration` owns *execution composition*, and this is
 * only what gets recorded about it.
 */

/**
 * Where a task is in its lifecycle.
 *
 * The five from `agno`, plus `cancelled`: a host that can suspend a run also
 * needs to say a task was *given up on* rather than failed.
 */
export type TaskStatus =
  | "pending" // created, not started
  | "in_progress" // someone is on it
  | "blocked" // waiting on something outside the task list
  | "completed"
  | "failed"
  | "cancelled"; // given up on deliberately

/**
 * One entry in the shared task list — what someone *intends* to do.
 *
 * Also the task step of a session's history: `getSteps` returns these alongside
 * action and plan steps, so "what was intended" reads back in the same order as
 * "what was planned" and "what was done".
 */
export interface Task {
  id: string;
  /** The session (run) the task belongs to. */
  sessionId: string;
  kind: "task";
  title: string;
  description?: string;
  status: TaskStatus;
  /**
   * Who is doing it — a delegated agent, a role, a human. Host vocabulary: this
   * package never interprets it.
   */
  assignee?: string;
  /**
   * Ids of tasks that must be `completed` before this one can start;
   * `readyTasks` is the read that applies this. An id that matches no task
   * **blocks** rather than unblocks, so a typo fails closed.
   */
  dependencies: string[];
  /** Groups a task under a parent (a sub-task). */
  parentId?: string;
  /** What the task produced, once it is done. */
  result?: string;
  /** Free-form notes a host appends as it goes. */
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * A step where something was *done*: a tool ran, or trying to run one failed.
 *
 * This is the intent-and-outcome view a run replays from, not a second copy of
 * telemetry: when a host records the same call in the execution graph it sets
 * `correlationId`, and the bodies stay where they already live. `summary` is
 * written by the host, already redacted — this package never inspects inputs or
 * outputs.
 */
export interface ActionStep {
  id: string;
  sessionId: string;
  kind: "action";
  /** What was attempted, in the host's words (already safe to display). */
  summary: string;
  /** The tool the step ran, when it ran one. */
  toolName?: string;
  /** Set when the step failed. */
  error?: string;
  durationMs?: number;
  /** Ties this step to the execution graph / telemetry event it describes. */
  correlationId?: string;
  createdAt: string;
}

/**
 * A step where a *plan* was produced — one message from the model, kept as
 * replayable state rather than conversation.
 *
 * This is what makes a planning interval meaningful: the plan is a record, so
 * re-planning reads the recorded state instead of re-deriving it.
 */
export interface PlanStep {
  id: string;
  sessionId: string;
  kind: "plan";
  /** The plan as ordered intents, in the model's words. */
  steps: string[];
  /** Why this plan was produced — a trigger, a failure, a new fact. */
  reasoning?: string;
  createdAt: string;
}

/**
 * One entry in a session's history: what was intended (`Task`), planned
 * (`PlanStep`) or done (`ActionStep`).
 */
export type StepRecord = Task | ActionStep | PlanStep;

/** The discriminator of {@link StepRecord}. */
export type StepKind = StepRecord["kind"];

/** Narrowing a session's tasks. */
export interface TaskFilter {
  status?: TaskStatus;
  assignee?: string;
  parentId?: string;
}

/** Narrowing a session's history. */
export interface StepFilter {
  kind?: StepKind;
}

/**
 * A partial update to a task. Identity (`id`, `sessionId`, `kind`, `createdAt`)
 * is not patchable; `updateTask` stamps `updatedAt`.
 */
export type TaskPatch = Omit<Partial<Task>, "id" | "sessionId" | "kind" | "createdAt">;
