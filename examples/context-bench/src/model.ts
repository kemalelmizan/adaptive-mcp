/**
 * Optional live-model mode.
 *
 * The deterministic harness answers "is the information available, and what does it
 * cost". This asks a real model the same questions with the same contexts, which is
 * the only way to see whether a strategy's advantage survives contact with a model.
 *
 * It is deliberately **not** part of the default run: it needs a server, it is not
 * deterministic, and CI must stay offline. Point it at any OpenAI-compatible endpoint:
 *
 *   pnpm --filter @adaptivemcp/context-bench bench -- --model http://127.0.0.1:8080/v1
 */

export interface ModelOptions {
  baseURL: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface ModelAnswer {
  text: string;
  /** Wall-clock time for the call. */
  durationMs: number;
}

/** Ask once. Temperature 0 so a rerun is as comparable as the server allows. */
export async function askModel(
  options: ModelOptions,
  context: string,
  question: string,
): Promise<ModelAnswer> {
  const started = Date.now();
  const response = await fetch(`${options.baseURL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      temperature: options.temperature ?? 0,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "Answer from the context only. If the context does not contain the answer, " +
            'reply exactly "unknown". Reply with the answer only, no explanation.',
        },
        { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` },
      ],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (!response.ok) {
    throw new Error(`model answered ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return {
    text: body.choices?.[0]?.message?.content?.trim() ?? "",
    durationMs: Date.now() - started,
  };
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

/**
 * Whether an answer means the same thing as the key.
 *
 * Case-insensitive, and number words are treated as their digits — "ten minutes" is
 * the same answer as "10 minutes". Nothing else is normalised: paraphrases that miss
 * the fact are misses, which is the honest reading of "did it answer".
 */
export function answersCorrectly(answer: string, fact: string): boolean {
  const normalize = (text: string): string =>
    text
      .toLowerCase()
      .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g, (word) => NUMBER_WORDS[word] ?? word)
      .replace(/\s+/g, " ")
      .trim();
  return normalize(answer).includes(normalize(fact));
}

/** Read the model config from flags/env; `undefined` keeps the run deterministic. */
export function modelFromEnv(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ModelOptions | undefined {
  const at = argv.indexOf("--model");
  const baseURL = at >= 0 ? argv[at + 1] : env.CONTEXT_BENCH_MODEL;
  if (!baseURL) return undefined;
  const nameAt = argv.indexOf("--model-name");
  return {
    baseURL,
    model: nameAt >= 0 ? (argv[nameAt + 1] ?? "local") : (env.CONTEXT_BENCH_MODEL_NAME ?? "local"),
  };
}
