/**
 * BaseProvider — VSCode-independent core functionality for the Private Model Provider extension.
 * This class contains all shared utilities and common behavior that is independent of VSCode's API.
 */


import { ILogger, IllmClient } from './interfaces';
import { GatewayConfig } from '../types';

/**
 * Shared utility methods used by both CopilotProvider and CLI implementation.
 * These methods are independent of VSCode's API and can be reused across different contexts.
 */
export class BaseProvider {
  public readonly logger: ILogger;
  public readonly client: IllmClient;
  protected config: GatewayConfig;

  constructor(logger: ILogger, client: IllmClient, config: GatewayConfig) {
    this.logger = logger;
    this.client = client;
    this.config = config;
  }

  /**
   * Execute a request function with exponential backoff retry logic.
   * Retries are driven by the provider configuration: `maxRetries` and `retryDelayMs`.
   * The delay doubles on each attempt (baseDelayMs * 2^attempt).
   * Only retries on the specific "Model unloaded" GatewayError.
   */
  public async requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = this.client.MaxRetries() ?? 3;
    const baseDelay = this.client.RetryDelayMs() ?? 500; // ms
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        const isModelUnloaded = err?.message?.includes('Model unloaded');
        if (!isModelUnloaded || attempt >= maxRetries) {
          throw err;
        }
        const delay = baseDelay * Math.pow(2, attempt);
        this.logger.warn(`Request failed with Model unloaded, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(res => setTimeout(res, delay));
        attempt++;
      }
    }
  }

  /**
   * Truncate messages to fit within a token limit.
   * Strategy: Keep the first message (usually system prompt) and the most recent messages.
   * Remove older messages from the middle of the conversation.
   */
  protected truncateMessagesToFit(messages: any[], maxTokens: number): any[] {
    if (messages.length === 0) {
      return messages;
    }

    // Calculate total tokens
    let totalTokens = 0;
    const messageTokens: number[] = [];
    for (const msg of messages) {
      const tokens = this.estimateMessageTokens(msg);
      messageTokens.push(tokens);
      totalTokens += tokens;
    }

    // If we're within limits, return as-is
    if (totalTokens <= maxTokens) {
      return messages;
    }

    this.logger.info(`Context overflow: ${totalTokens} tokens > ${maxTokens} limit. Truncating...`);

    // Strategy: Keep first message (system) and as many recent messages as possible
    const result: any[] = [];
    let usedTokens = 0;

    // Always keep the first message if it exists (usually system prompt)
    if (messages.length > 0) {
      result.push(messages[0]);
      usedTokens += messageTokens[0];
    }

    // Work backwards from the end, adding messages until we hit the limit
    const recentMessages: any[] = [];
    for (let i = messages.length - 1; i > 0; i--) {
      const msgTokens = messageTokens[i];
      if (usedTokens + msgTokens <= maxTokens) {
        recentMessages.unshift(messages[i]);
        usedTokens += msgTokens;
      } else {
        // Stop when we can't fit more messages
        break;
      }
    }

    // Combine first message with recent messages
    result.push(...recentMessages);

    this.logger.info(`Truncated: kept ${result.length}/${messages.length} messages, ~${usedTokens} tokens`);

    return result;
  }

  /**
   * Estimate token count for a message.
   */
  protected estimateMessageTokens(message: any): number {
    let text = '';
    if (typeof message.content === 'string') {
      text = message.content;
    } else if (message.content) {
      text = JSON.stringify(message.content);
    }
    if (message.tool_calls) {
      text += JSON.stringify(message.tool_calls);
    }
    // Rough estimate: ~4 or 5 characters per token
    return Math.ceil(text.length / 5);
  }

  /**
   * Fill in missing required properties with default values based on the tool schema.
   */
  protected fillMissingRequiredProperties(args: Record<string, unknown>, toolName: string, toolSchema: any): Record<string, unknown> {
    if (!toolSchema?.required || !Array.isArray(toolSchema.required)) {
      return args;
    }

    const properties = (toolSchema.properties || {}) as Record<string, any>;
    const filledArgs = { ...args };
    const filledProperties: string[] = [];

    for (const requiredProp of toolSchema.required as string[]) {
      if (!(requiredProp in filledArgs)) {
        const propSchema = properties[requiredProp];
        const defaultValue = this.getDefaultForType(propSchema);
        filledArgs[requiredProp] = defaultValue;
        filledProperties.push(`${requiredProp}=${JSON.stringify(defaultValue)}`);
      }
    }

    if (filledProperties.length > 0) {
      this.logger.info(`  AUTO-FILLED missing required properties: ${filledProperties.join(', ')}`);
    }

    return filledArgs;
  }

  /**
   * Estimate default value for a JSON schema type.
   */
  private getDefaultForType(schema: any): unknown {
    if (!schema?.type) {
      return null;
    }

    switch (schema.type) {
      case 'string':
        return schema.default ?? '';
      case 'number':
      case 'integer':
        return schema.default ?? 0;
      case 'boolean':
        return schema.default ?? false;
      case 'array':
        return schema.default ?? [];
      case 'object':
        return schema.default ?? {};
      case 'null':
        return null;
      default:
        // Handle union types like ["string", "null"]
        if (Array.isArray(schema.type)) {
          if (schema.type.includes('null')) {
            return null;
          }
          // Use first non-null type
          for (const t of schema.type) {
            if (t !== 'null') {
              return this.getDefaultForType({ ...schema, type: t });
            }
          }
        }
        return null;
    }
  }

  /**
   * Attempt to repair truncated or malformed JSON arguments.
   */
  protected tryRepairJson(jsonStr: string): unknown {
    if (!jsonStr || jsonStr.trim() === '') {
      return {};
    }

    // First, try direct parse
    try {
      return JSON.parse(jsonStr);
    } catch {
      // Continue to repair attempts
    }

    // Attempt repairs for common issues
    let repaired = jsonStr.trim();

    // Fix missing closing brackets/braces
    repaired = this.balanceBrackets(repaired);

    // Fix trailing comma before closing brace/bracket
    repaired = repaired.replaceAll(/,\s*([{}\[])/g, '$1');

    // Fix truncated string value - close the string if odd number of quotes
    if (this.countChar(repaired, '"') % 2 !== 0) {
      repaired += '"';
      repaired = this.balanceBrackets(repaired);
    }

    try {
      return JSON.parse(repaired);
    } catch {
      this.logger.error(`JSON repair failed. Original: ${jsonStr}`);
      this.logger.error(`Repaired attempt: ${repaired}`);
      return null;
    }
  }

  /**
   * Count occurrences of a character in a string.
   */
  private countChar(str: string, char: string): number {
    // Escape regex special characters in the search char
    const escapePattern = /[.*+?^${}()|[\]\\]/g;
    const escapedChar = char.replace(escapePattern, '\\$&');
    const regex = new RegExp(escapedChar, 'g');
    let count = 0;
    while (regex.exec(str) !== null) {
      count++;
    }
    return count;
  }

  /**
   * Balance unclosed braces/brackets in a JSON string.
   */
  private balanceBrackets(str: string): string {
    let result = str;
    const missingBrackets = this.countChar(result, '[') - this.countChar(result, ']');
    const missingBraces = this.countChar(result, '{') - this.countChar(result, '}');

    result += ']' .repeat(Math.max(0, missingBrackets));
    result += '}' .repeat(Math.max(0, missingBraces));

    return result;
  }

  /**
   * Calculate exponential backoff delay with jitter.
   * The delay doubles on each attempt (baseDelayMs * 2^attempt).
   * Jitter adds up to 30% random variation for better retry distribution.
   */
  public calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = this.client.RetryDelayMs() ?? 500;
    return Math.min(exponentialDelay * Math.pow(2, attempt), (exponentialDelay * 16) + (Math.random() - 0.5) * exponentialDelay);
  }

  /**
   * Check if an error should be retried.
   * Returns true for timeout errors and network-level failures.
   */
  public isRetryableError(error: unknown, statusCode?: number): boolean {
    if (statusCode && [429, 500, 502, 503, 504].includes(statusCode)) {
      return true;
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('network') ||
        message.includes('abort')
      );
    }
    return false;
  }

  /**
   * Sleep for the specified milliseconds.
   */
  public sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}