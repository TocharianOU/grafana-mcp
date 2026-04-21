import { encoding_for_model, type TiktokenModel } from "tiktoken";

export interface TokenCheckResult {
  allowed: boolean;
  tokens: number;
  error?: string;
}

/**
 * Calculates the token count of a text string using the tiktoken GPT-4 tokenizer.
 * Falls back to a character-based estimate if tiktoken fails.
 */
export function calculateTokens(
  text: string,
  model: TiktokenModel = "gpt-4"
): number {
  try {
    const encoding = encoding_for_model(model);
    const tokens = encoding.encode(text);
    const count = tokens.length;
    encoding.free();
    return count;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Checks whether a tool result exceeds the configured token limit.
 * Returns an error descriptor when the limit is exceeded, allowing the
 * caller to surface actionable guidance to the AI instead of returning
 * a truncated or oversized payload.
 *
 * @param result      The full tool result object to measure.
 * @param maxTokens   Maximum allowed token count.
 * @param breakRule   When true the check is bypassed and the result is always allowed.
 */
export function checkTokenLimit(
  result: unknown,
  maxTokens: number,
  breakRule = false
): TokenCheckResult {
  if (breakRule) return { allowed: true, tokens: 0 };

  const text = JSON.stringify(result);
  const tokens = calculateTokens(text);

  if (tokens > maxTokens) {
    return {
      allowed: false,
      tokens,
      error:
        `Token limit exceeded: result contains ${tokens} tokens (limit: ${maxTokens}).\n\n` +
        "Suggestions:\n" +
        "1. Reduce the size/limit parameters in your query\n" +
        "2. Narrow down the time range or date filters\n" +
        "3. Add more specific query filters to reduce result set\n" +
        "4. Use aggregations instead of raw documents when possible\n" +
        "5. If absolutely necessary, retry with break_token_rule: true\n\n" +
        "Note: Frequent use of break_token_rule may cause context overflow and degraded AI performance.",
    };
  }

  return { allowed: true, tokens };
}
