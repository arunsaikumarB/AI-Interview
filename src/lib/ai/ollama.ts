import { z, type ZodType } from "zod";

/**
 * Ollama client — chat via AI_PROVIDER (local | cloud), embeddings always local.
 * Production is 100% local. Cloud is DEV-only behind AI_PROVIDER=cloud.
 */

export class AIError extends Error {
  readonly code:
    | "OLLAMA_UNREACHABLE"
    | "OLLAMA_HTTP"
    | "INVALID_JSON"
    | "VALIDATION"
    | "EMBEDDING";
  readonly causeDetail?: unknown;

  constructor(
    code: AIError["code"],
    message: string,
    causeDetail?: unknown,
  ) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.causeDetail = causeDetail;
  }
}

export type AIProvider = "local" | "cloud";

const DEFAULT_LOCAL_URL = "http://localhost:11434";
const DEFAULT_CLOUD_URL = "https://ollama.com";

export function getAIProvider(): AIProvider {
  const raw = (process.env.AI_PROVIDER ?? "local").toLowerCase().trim();
  return raw === "cloud" ? "cloud" : "local";
}

/** Local Ollama — used for embeddings always, and for chat when AI_PROVIDER=local. */
export function getLocalOllamaUrl(): string {
  return (
    process.env.OLLAMA_LOCAL_URL ??
    (getAIProvider() === "local"
      ? (process.env.OLLAMA_BASE_URL ?? DEFAULT_LOCAL_URL)
      : DEFAULT_LOCAL_URL)
  ).replace(/\/$/, "");
}

/** Chat host for the active provider. */
export function getChatOllamaUrl(): string {
  if (getAIProvider() === "cloud") {
    const configured = process.env.OLLAMA_CLOUD_URL ?? process.env.OLLAMA_BASE_URL;
    if (
      configured &&
      !configured.includes("localhost") &&
      !configured.includes("127.0.0.1")
    ) {
      return configured.replace(/\/$/, "");
    }
    return DEFAULT_CLOUD_URL;
  }
  return getLocalOllamaUrl();
}

const OLLAMA_MODEL = () =>
  process.env.OLLAMA_CHAT_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b";
const OLLAMA_EMBED_MODEL = () =>
  process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const OLLAMA_API_KEY = () => process.env.OLLAMA_API_KEY?.trim() || "";

function assertCloudKey(): void {
  if (getAIProvider() === "cloud" && !OLLAMA_API_KEY()) {
    throw new AIError(
      "VALIDATION",
      "AI_PROVIDER=cloud requires OLLAMA_API_KEY. Set the key or switch AI_PROVIDER=local.",
    );
  }
}

function chatHeaders(json = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  // Local ignores the key; cloud sends Bearer.
  if (getAIProvider() === "cloud") {
    assertCloudKey();
    headers.Authorization = `Bearer ${OLLAMA_API_KEY()}`;
  }
  return headers;
}

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function ollamaFetch<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: HeadersInit,
  timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 240_000),
): Promise<T> {
  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AIError(
        "OLLAMA_UNREACHABLE",
        `Ollama timed out after ${Math.round(timeoutMs / 1000)}s at ${baseUrl}. The model may be slow on CPU — retry, or use a smaller chat model.`,
        err,
      );
    }
    throw new AIError(
      "OLLAMA_UNREACHABLE",
      `Ollama is unreachable at ${baseUrl}. Is it running?`,
      err,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AIError(
      "OLLAMA_HTTP",
      `Ollama ${path} failed (${res.status}): ${text || res.statusText}`,
      { status: res.status, body: text },
    );
  }

  return res.json() as Promise<T>;
}

function parseJsonLoose(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new AIError(
      "INVALID_JSON",
      `Model returned non-JSON content: ${err instanceof Error ? err.message : "parse error"}`,
      content,
    );
  }
}

function resolveOllamaFormat(
  zodSchema: ZodType<unknown>,
  jsonSchema?: Record<string, unknown>,
): "json" | Record<string, unknown> {
  const source = jsonSchema ?? (() => {
    try {
      return z.toJSONSchema(zodSchema as never) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (!source || typeof source !== "object") return "json";

  // Ollama wants a plain JSON Schema object (no draft $schema marker).
  const rest = { ...source };
  delete rest.$schema;
  return Object.keys(rest).length > 0 ? rest : "json";
}

/**
 * Chat with Ollama, force JSON / JSON-Schema format, validate with Zod.
 * Uses AI_PROVIDER host (local or cloud).
 */
export async function chatJSON<T>(
  system: string,
  user: string,
  zodSchema: ZodType<T>,
  options?: {
    model?: string;
    temperature?: number;
    numPredict?: number;
    /** Explicit JSON Schema for Ollama structured outputs. */
    jsonSchema?: Record<string, unknown>;
  },
): Promise<{ data: T; model: string; raw: unknown }> {
  const model = options?.model ?? OLLAMA_MODEL();
  const temperature = options?.temperature ?? 0.1;
  const baseUrl = getChatOllamaUrl();
  const headers = chatHeaders(true);
  const format = resolveOllamaFormat(
    zodSchema as ZodType<unknown>,
    options?.jsonSchema,
  );

  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const userContent =
      attempt === 1 || !lastError
        ? user
        : `${user}\n\nYour previous output was invalid: ${lastError}. Return only valid JSON matching the schema. Arrays must be JSON arrays of strings, never a single string.`;

    const raw = await ollamaFetch<{
      model?: string;
      message?: { content?: string };
    }>(baseUrl, "/api/chat", {
      model,
      stream: false,
      format,
      options: {
        temperature,
        // Cap plan/turn JSON size so CPU hosts don't run for many minutes.
        num_predict: options?.numPredict ?? 2048,
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ] satisfies OllamaMessage[],
    }, headers);

    const content = raw.message?.content ?? "";
    const usedModel = raw.model ?? model;

    try {
      const parsed = parseJsonLoose(content);
      const data = zodSchema.parse(parsed);
      return { data, model: usedModel, raw };
    } catch (err) {
      if (err instanceof AIError && err.code === "INVALID_JSON") {
        lastError = err.message;
      } else if (err instanceof z.ZodError) {
        lastError = err.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
      } else {
        lastError = err instanceof Error ? err.message : "Unknown validation error";
      }

      if (attempt === 2) {
        throw new AIError(
          err instanceof AIError && err.code === "INVALID_JSON"
            ? "INVALID_JSON"
            : "VALIDATION",
          `Ollama returned invalid structured output after 2 attempts: ${lastError}`,
          { lastError, content },
        );
      }
    }
  }

  throw new AIError("VALIDATION", "Unreachable chatJSON state");
}

/**
 * Embeddings ALWAYS use local Ollama (cloud has no embeddings API).
 * No API key. Callers should catch failures — never block screening.
 */
export async function embed(text: string): Promise<number[]> {
  const model = OLLAMA_EMBED_MODEL();
  const baseUrl = getLocalOllamaUrl();
  const data = await ollamaFetch<{ embedding?: number[] }>(
    baseUrl,
    "/api/embeddings",
    { model, prompt: text },
    { "Content-Type": "application/json" },
  );

  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new AIError("EMBEDDING", "Ollama returned an empty embedding");
  }

  return data.embedding;
}

async function pingOllama(
  baseUrl: string,
  headers: HeadersInit,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      cache: "no-store",
      headers,
    });
    if (!res.ok) {
      return { ok: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    return {
      ok: true,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : "Unreachable",
    };
  }
}

export async function healthCheck(): Promise<{
  ok: boolean;
  provider: AIProvider;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  embedBaseUrl: string;
  models: string[];
  error?: string;
  embeddings: { ok: boolean; baseUrl: string; error?: string };
}> {
  const provider = getAIProvider();
  const baseUrl = getChatOllamaUrl();
  const embedBaseUrl = getLocalOllamaUrl();

  let chatHeadersInit: HeadersInit = {};
  if (provider === "cloud") {
    const key = OLLAMA_API_KEY();
    if (!key) {
      return {
        ok: false,
        provider,
        baseUrl,
        chatModel: OLLAMA_MODEL(),
        embedModel: OLLAMA_EMBED_MODEL(),
        embedBaseUrl,
        models: [],
        error: "AI_PROVIDER=cloud requires OLLAMA_API_KEY",
        embeddings: { ok: false, baseUrl: embedBaseUrl, error: "not checked" },
      };
    }
    chatHeadersInit = { Authorization: `Bearer ${key}` };
  }

  const chat = await pingOllama(baseUrl, chatHeadersInit);
  const emb = await pingOllama(embedBaseUrl, {});

  return {
    ok: chat.ok,
    provider,
    baseUrl,
    chatModel: OLLAMA_MODEL(),
    embedModel: OLLAMA_EMBED_MODEL(),
    embedBaseUrl,
    models: chat.models,
    error: chat.error,
    embeddings: {
      ok: emb.ok,
      baseUrl: embedBaseUrl,
      error: emb.error,
    },
  };
}

export function getOllamaConfig() {
  const provider = getAIProvider();
  return {
    provider,
    baseUrl: getChatOllamaUrl(),
    localUrl: getLocalOllamaUrl(),
    chatModel: OLLAMA_MODEL(),
    embedModel: OLLAMA_EMBED_MODEL(),
    hasApiKey: Boolean(OLLAMA_API_KEY()),
  };
}

/** Startup / ops warning when cloud chat is enabled. */
export function logCloudProviderWarning(): void {
  if (getAIProvider() !== "cloud") return;
  console.warn(
    [
      "",
      "╔══════════════════════════════════════════════════════════════════╗",
      "║  DEV MODE — AI running on Ollama Cloud                         ║",
      "║  Candidate data leaves this machine. Not for production.       ║",
      "║  Set AI_PROVIDER=local for production.                         ║",
      "╚══════════════════════════════════════════════════════════════════╝",
      "",
    ].join("\n"),
  );
}
