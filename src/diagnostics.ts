export type FailureStage = "preflight" | "request" | "provider-response" | "validation";

export interface ResponseSummary {
  stopReason: string;
  content: readonly { type: string }[];
}

function errorFields(error: unknown): { message: string; status?: number } {
  if (typeof error === "string") {
    return { message: error };
  }
  if (!error || typeof error !== "object") {
    return { message: "" };
  }

  const value = error as { message?: unknown; status?: unknown; cause?: unknown };
  const message = typeof value.message === "string" ? value.message : "";
  const status =
    typeof value.status === "number" &&
    Number.isInteger(value.status) &&
    value.status >= 400 &&
    value.status <= 599
      ? value.status
      : undefined;
  // Fetch errors often put a connection code on the cause. Never render it directly.
  const cause = value.cause as { code?: unknown } | undefined;
  const code = cause && typeof cause.code === "string" ? cause.code : "";
  return { message: `${message}\n${code}`, status };
}

/** Classify privately; emit only fixed labels and validated numbers, never error excerpts. */
export function errorHint(error: unknown): { hint: string; status?: number } {
  const fields = errorFields(error);
  const message = fields.message;
  const status =
    fields.status ?? (Number(/^(?:HTTP\s+)?([45]\d\d)\b/i.exec(message)?.[1]) || undefined);
  const rejection =
    /unsupported|not supported|invalid|unknown|must be|expected|allowed|does not support/i;
  let hint = "unknown";

  if (
    /reasoning[_ -]?effort|enable_thinking|thinking[_ -]?budget/i.test(message) &&
    rejection.test(message)
  ) {
    hint = "reasoning-option";
  } else if (
    /context.{0,40}(exceed|length|size|limit|full)|too (many|large).{0,30}tokens|exceeds.{0,30}context/i.test(
      message,
    )
  ) {
    hint = "context-limit";
  } else if (/jinja|chat[_ -]?template|template error/i.test(message)) {
    hint = "chat-template";
  } else if (status === 401 || status === 403) {
    hint = "authentication";
  } else if (status === 429) {
    hint = "rate-limit";
  } else if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|connection error/i.test(message)
  ) {
    hint = "connection";
  } else if (status !== undefined && status >= 500) {
    hint = "server-error";
  } else if (status !== undefined && status >= 400) {
    hint = "request-rejected";
  }

  return { hint, status };
}

export function failureDiagnostics(
  stage: FailureStage,
  error: unknown,
  maxTokens: number | undefined,
  response: ResponseSummary | undefined,
): string {
  const fields = [`stage=${stage}`];
  if (stage === "request" || stage === "provider-response") {
    const { hint, status } = errorHint(error);
    fields.push(`hint=${hint}`);
    if (status !== undefined) {
      fields.push(`http=${status}`);
    }
  }
  if (maxTokens !== undefined) {
    fields.push(`maxTokens=${maxTokens}`);
  }
  if (response) {
    const stop = ["stop", "length", "toolUse", "error", "aborted"].includes(response.stopReason)
      ? response.stopReason
      : "unknown";
    fields.push(
      `stop=${stop}`,
      `textBlocks=${response.content.filter((block) => block.type === "text").length}`,
      `thinkingBlocks=${response.content.filter((block) => block.type === "thinking").length}`,
    );
  }
  return `Rename diagnostics: ${fields.join("; ")}.`;
}
