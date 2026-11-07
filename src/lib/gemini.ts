import { env } from "./env";

/**
 * Minimal Gemini client: one call, JSON in, JSON out, over plain fetch.
 * No SDK, so the dependency list stays short and the request is visible.
 * GEMINI_API_BASE lets tests point this at a local fake.
 */
const API_BASE = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta";

export class GeminiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GeminiError";
  }
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  error?: { message?: string };
};

/**
 * Ask for a JSON document matching `schema`. Returns the raw text; the
 * caller validates it, since the model can still miss the schema's intent.
 */
export async function generateJson(prompt: string, schema: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<{ text: string; model: string }> {
  const model = env.GEMINI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0.4 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new GeminiError(err instanceof Error && err.name === "AbortError" ? "Gemini did not answer in time" : `Could not reach Gemini: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => ({}))) as GenerateResponse;
  if (!res.ok) {
    const msg = body.error?.message ?? res.statusText;
    throw new GeminiError(res.status === 429 ? "Gemini's free tier limit was hit; try again later" : `Gemini error ${res.status}: ${msg}`, res.status);
  }
  const text = body.candidates?.flatMap((c) => c.content?.parts ?? []).map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new GeminiError("Gemini returned an empty answer");
  return { text, model };
}
