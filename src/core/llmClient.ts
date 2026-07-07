import * as http from 'http';
import * as https from 'https';


import { randomBytes } from 'node:crypto';

import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIModelsResponse,
} from '../types';
import { IllmClient, StreamChunk, StreamingToolCall, IllmClientConfig } from './interfaces';
import { SecretManager } from '../secretManager';

/**
 * Retry configuration for failed requests. Kept as a separate interface so it
 * can be overridden per-instance without coupling to the client config.
 */
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: number[];
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Error class for Gateway-specific errors
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * State for tracking tool calls during streaming
 */
interface ToolCallState {
  toolCallsByIndex: Map<number, StreamingToolCall>;
  finalizedIndices: Set<number>;
  requestId: string;
  toolCallCounter: number;
  lastUsage?: ParsedChunk['usage'];
  handleSSEError(error: Error): void;
}

/**
 * Parsed SSE chunk data, now including optional usage object for final response.
 */
interface ParsedChunk {
  delta?: {
    content?: string;
    reasoning_content?: string;
    reasoning?: string;
    thinking?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
    function_call?: { name?: string; arguments?: string };
  };
  message?: {
    content?: string;
    reasoning_content?: string;
    reasoning?: string;
    thinking?: string;
    text?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
    function_call?: { name?: string; arguments?: string };
  };
  finishReason?: string;
  id?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * HTTP client for OpenAI-compatible inference servers.
 * 
 * The LlmClient class provides the core networking and request handling for all
 * provider implementations in this extension. It handles:
 * - HTTP requests to /v1/chat/completions, /v1/models, and LM Studio's /api/v1/models endpoints
 * - Retry logic with exponential backoff and jitter for transient failures
 * - SSE streaming of chat completions with tool call tracking and usage parsing
 * - Error handling with GatewayError for network-level failures
 * 
 * The client is configured via {@link IllmClientConfig} (server URL, API key, timeouts) and
 * retry configuration (max retries, base delay, max delay). It provides a clean
 * interface that can be reused by CopilotProvider, ChatProvider, or any future CLI implementation.
 */
export class LlmClient implements IllmClient {
  protected config: IllmClientConfig;
  private retryConfig: RetryConfig;

  constructor(config: IllmClientConfig, retryConfig?: Partial<RetryConfig>) {
    this.config = config;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /** Update client configuration */
  public updateConfig(config: IllmClientConfig): void {
    this.config = config;
  }

  public MaxRetries(): number {
    return this.retryConfig.maxRetries;
  }

  public RetryDelayMs(): number {
    return this.retryConfig.baseDelayMs;
  }


  /** Calculate exponential backoff delay with jitter */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelayMs);
  }

  /** Check if an error is retryable */
  protected isRetryableError(error: unknown, statusCode?: number): boolean {
    if (statusCode && this.retryConfig.retryableStatusCodes.includes(statusCode)) {
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

  /** Sleep for specified milliseconds */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Fetch with retry logic */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit,
    operation: string
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const response = await this.fetch(url, options);

        if (!response.ok && this.isRetryableError(null, response.status)) {
          if (attempt < this.retryConfig.maxRetries) {
            const delay = this.calculateBackoffDelay(attempt);
            console.log(`[LLM Gateway] ${operation} failed with status ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.retryConfig.maxRetries})`);
            await this.sleep(delay);
            continue;
          } else {
          throw new GatewayError(`${operation} failed with status ${response.status}: ${response.statusText}`,response.status, this.isRetryableError(null, response.status));
          }
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isRetryableError(error) && attempt < this.retryConfig.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          console.log(`[LLM Gateway] ${operation} failed with error: ${lastError.message}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.retryConfig.maxRetries})`);
          await this.sleep(delay);
          continue;
        }

        throw new GatewayError(
          `${operation} failed after ${attempt + 1} attempts: ${lastError.message}`,
          undefined,
          false,
          lastError
        );
      }
    }

    throw new GatewayError(
      `${operation} failed after ${this.retryConfig.maxRetries + 1} attempts`,
      undefined,
      false,
      lastError
    );
  }

  /** Fetch available models from /v1/models endpoint */
  public async fetchModels(): Promise<OpenAIModelsResponse> {
    const url = `${this.config.serverUrl}/v1/models`;

    const apiKey = await SecretManager.getClientApiKey();
    try {
      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        headers: this.getHeaders(apiKey),
      }, 'Fetch models');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new GatewayError(
          `Failed to fetch models: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status,
          this.isRetryableError(null, response.status)
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof GatewayError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new GatewayError(
          `Failed to connect to inference server: ${error.message}`,
          undefined,
          this.isRetryableError(error),
          error
        );
      }
      throw error;
    }
  }

  /**
   * Fetch available models from LM Studio's `/api/v1/models` endpoint.
   * This endpoint returns richer model metadata (including token limits).
   * The response shape is not strictly defined here – we treat it as any and
   * let the caller map the fields to the VS Code model interface.
   */
  public async fetchLMStudioModels(): Promise<any> {
    // LM Studio uses a slightly different base path for its REST API.
    const url = `${this.config.serverUrl}/api/v1/models`;

    const apiKey = await SecretManager.getClientApiKey();
    try {
      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        headers: this.getHeaders(apiKey),
      }, 'Fetch LM Studio models');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new GatewayError(
          `Failed to fetch LM Studio models: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status,
          this.isRetryableError(null, response.status)
        );
      }

      // The LM Studio endpoint returns a JSON object with a `data` array similar to OpenAI.
      return await response.json();
    } catch (error) {
      if (error instanceof GatewayError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new GatewayError(
          `Failed to connect to LM Studio server: ${error.message}`,
          undefined,
          this.isRetryableError(error),
          error
        );
      }
      throw error;
    }
  }

  /** Create initial tool call tracking state */
  private createToolCallState(): ToolCallState {
    return {
      toolCallsByIndex: new Map<number, StreamingToolCall>(),
      finalizedIndices: new Set<number>(),
      requestId: `req_${Date.now()}_${randomBytes(4).toString('hex')}`,
      toolCallCounter: 0,
      handleSSEError: (error: Error) => {
        console.error('[LLM Gateway] SSE stream error:', error);
      },
    };
  }

  /** Process a single streamed tool call delta */
  private processToolCallDelta(
    tc: { index?: number; id?: string; function?: { name?: string; arguments?: string } },
    state: ToolCallState
  ): void {
    const index = tc.index ?? state.toolCallCounter++;
    const existing = state.toolCallsByIndex.get(index);

    if (existing) {
      if (tc.id) { existing.id = tc.id; }
      if (tc.function?.name) { existing.name = tc.function.name; }
      if (tc.function?.arguments) { existing.arguments += tc.function.arguments; }
    } else {
      state.toolCallsByIndex.set(index, {
        id: tc.id || '',
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '',
      });
    }
  }

  /** Process legacy function_call format */
  private processLegacyFunctionCall(
    functionCall: { name?: string; arguments?: string },
    parsedId: string,
    state: ToolCallState
  ): void {
    const index = 0;
    const existing = state.toolCallsByIndex.get(index);

    if (existing) {
      if (functionCall.name) { existing.name = functionCall.name; }
      if (functionCall.arguments) { existing.arguments += functionCall.arguments; }
    } else {
      state.toolCallsByIndex.set(index, {
        id: parsedId || '',
        name: functionCall.name || '',
        arguments: functionCall.arguments || '',
      });
    }
  }

  /** Finalize all pending tool calls */
  private finalizeToolCalls(state: ToolCallState): StreamingToolCall[] {
    const finishedToolCalls: StreamingToolCall[] = [];

    for (const [index, tc] of state.toolCallsByIndex.entries()) {
      if (!state.finalizedIndices.has(index)) {
        state.finalizedIndices.add(index);
        if (!tc.id) {
          tc.id = `call_${state.requestId}_${index}`;
        }
        finishedToolCalls.push({ ...tc });
      }
    }

    return finishedToolCalls;
  }

  /** Extract reasoning content from delta or message (supports multiple API formats) */
  private extractReasoningContent(obj: { reasoning_content?: string; reasoning?: string; thinking?: string } | undefined): string | undefined {
    if (!obj) return undefined;
    return obj.reasoning_content || obj.reasoning || obj.thinking || undefined;
  }

  /** Process delta format from streaming response */
  private processDeltaFormat(
    parsed: ParsedChunk,
    state: ToolCallState
  ): { content: string; reasoning_content?: string; finishedToolCalls: StreamingToolCall[] } {
    const delta = parsed.delta!;
    const finishedToolCalls: StreamingToolCall[] = [];

    // Handle streamed tool_calls
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        this.processToolCallDelta(tc, state);
      }
    }

    // Handle legacy function_call format
    if (delta.function_call) {
      this.processLegacyFunctionCall(delta.function_call, parsed.id || '', state);
    }

    // Check if tool calls are complete
    if (parsed.finishReason === 'tool_calls' || parsed.finishReason === 'function_call') {
      finishedToolCalls.push(...this.finalizeToolCalls(state));
    }

    const reasoning_content = this.extractReasoningContent(delta);

    return { content: delta.content || '', reasoning_content, finishedToolCalls };
  }

  /** Process non-delta (final) message format */
  private processMessageFormat(
    parsed: ParsedChunk,
    state: ToolCallState
  ): { content: string; reasoning_content?: string; finishedToolCalls: StreamingToolCall[] } {
    const message = parsed.message!;
    const finishedToolCalls: StreamingToolCall[] = [];

    // Handle complete tool_calls array
    if (Array.isArray(message.tool_calls)) {
      for (let i = 0; i < message.tool_calls.length; i++) {
        const tc = message.tool_calls[i];
        const index = tc.index ?? i;
        if (!state.finalizedIndices.has(index)) {
          state.finalizedIndices.add(index);
          finishedToolCalls.push({
            id: tc.id || `call_${state.requestId}_${index}`,
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '',
          });
        }
      }
    }

    // Handle legacy function_call format
    if (message.function_call && !state.finalizedIndices.has(0)) {
      state.finalizedIndices.add(0);
      finishedToolCalls.push({
        id: parsed.id || `call_${state.requestId}_0`,
        name: message.function_call.name || '',
        arguments: message.function_call.arguments || '',
      });
    }

    const reasoning_content = this.extractReasoningContent(message);

    return { content: message.content || message.text || '', reasoning_content, finishedToolCalls };
  }

  /** Parse a raw SSE data string into structured chunk data */
  private parseSSEData(data: string): ParsedChunk | null {
    try {
      const parsed = JSON.parse(data);
      return {
        delta: parsed.choices?.[0]?.delta,
        message: parsed.choices?.[0]?.message,
        finishReason: parsed.choices?.[0]?.finish_reason,
        id: parsed.id,
        usage: parsed.usage,
      };
    } catch {
      console.error('Failed to parse SSE chunk:', data);
      return null;
    }
  }

  /** Process a single SSE line and return yield data if applicable, including usage. */
  private processSSELine(
    line: string,
    state: ToolCallState
  ): StreamChunk | null {
    const trimmed = line.trim();

    if (trimmed === '' || trimmed === 'data: [DONE]') {
      return null;
    }

    if (!trimmed.startsWith('data: ')) {
      return null;
    }

    const data = trimmed.slice(6);
    const parsed = this.parseSSEData(data);
    if (!parsed) { return null; }

    let result: StreamChunk;

    if (parsed.delta) {
      const { content, reasoning_content: rc, finishedToolCalls } = this.processDeltaFormat(parsed, state);
      result = { content, reasoning_content: rc, tool_calls: [], finished_tool_calls: finishedToolCalls, usage: parsed.usage };
    } else if (parsed.message) {
      const { content, reasoning_content: rc, finishedToolCalls } = this.processMessageFormat(parsed, state);
      result = { content, reasoning_content: rc, tool_calls: [], finished_tool_calls: finishedToolCalls, usage: parsed.usage };
    } else if (parsed.usage) {
      result = { content: '', reasoning_content: '', tool_calls: [], finished_tool_calls: [], usage: parsed.usage };
    } else {
      return null;
    }

    return result;
  }

  /** Get remaining unfinalised tool calls */
  private getRemainingToolCalls(state: ToolCallState): StreamingToolCall[] {
    const remaining: StreamingToolCall[] = [];

    for (const [index, tc] of state.toolCallsByIndex.entries()) {
      if (!state.finalizedIndices.has(index) && (tc.name || tc.arguments)) {
        state.finalizedIndices.add(index);
        if (!tc.id) {
          tc.id = `call_${state.requestId}_${index}`;
        }
        remaining.push({ ...tc });
      }
    }

    return remaining;
  }

  /**
   * Stream chat completions from /v1/chat/completions endpoint.
   * The optional abortSignal can be used to cancel the stream.
   */
  public async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const url = `${this.config.serverUrl}/v1/chat/completions`;
    const state = this.createToolCallState();

    const apiKey = await SecretManager.getClientApiKey();
    try {
      const response = await this.fetchWithRetry(url, {
        method: 'POST',
        headers: this.getHeaders(apiKey),
        body: JSON.stringify({ ...request, stream: true, stream_options: { include_usage: true } }),
      }, 'Chat completion');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new GatewayError(
          `Chat completion failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status,
          this.isRetryableError(null, response.status)
        );
      }

      if (!response.body) {
        throw new GatewayError('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let receivedAnyData = false;

      while (true) {
        if (abortSignal?.aborted) {
          console.log('[LLM Gateway] Cancellation requested, aborting stream');
          await reader.cancel();
          throw new Error('Stream cancelled by user');
        }

        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (readError) {
          if (receivedAnyData) {
            console.warn('[LLM Gateway] Stream read interrupted after receiving data, treating as end-of-stream:', readError);
            break;
          }
          throw readError;
        }

        const { done, value } = readResult;
        if (done) { break; }

        buffer += decoder.decode(value, { stream: true });
        receivedAnyData = true;

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (abortSignal?.aborted) {
            console.log('[LLM Gateway] Cancellation requested during line processing, aborting stream');
            await reader.cancel();
            return;
          }

          console.log(line);
          const result = this.processSSELine(line, state);
          if (result) {
            if (result.usage) {
              (state as any).lastUsage = result.usage;
              result.usage = undefined;
            }
            yield result;
          }
        }
      }

      // Flush decoder
      buffer += decoder.decode();

      if (buffer.trim()) {
        const result = this.processSSELine(buffer, state);
        if (result) { yield result; }
      }

      const remaining = this.getRemainingToolCalls(state);
      if (remaining.length > 0) {
        yield { content: '', tool_calls: [], finished_tool_calls: remaining };
      }

      if (state['lastUsage']) {
        yield { content: '', tool_calls: [], finished_tool_calls: [], usage: state['lastUsage'] as ParsedChunk['usage'] };
        (state as any).lastUsage = undefined;
      }
    } catch (error) {
      if (error instanceof GatewayError) {
        throw error;
      }
      if (error instanceof Error) {
        if (error.message === 'Stream cancelled by user') {
          console.log('[LLM Gateway] Stream was cancelled by user');
          return;
        }
        const msg = error.message?.toLowerCase() || '';
        if (
          msg === 'terminated' ||
          msg.includes('other side closed') ||
          msg.includes('aborted') ||
          msg.includes('socket hang up') ||
          msg.includes('econnreset') ||
          msg.includes('premature close')
        ) {
          throw new GatewayError(
            `Chat completion request failed: connection was terminated by the server. ` +
            `This often happens when the inference server does not support certain request parameters. ` +
            `Troubleshooting: 1) Check the inference server logs for errors, ` +
            `2) Try disabling 'parallel_tool_calls' in settings, ` +
            `3) Try disabling tool calling entirely, ` +
            `4) Ensure the model is fully loaded on the server.`,
            undefined,
            false,
            error
          );
        }
        throw new GatewayError(
          `Chat completion request failed: ${error.message}`,
          undefined,
          this.isRetryableError(error),
          error
        );
      }
      throw error;
    }
  }

  /** Get headers for API requests */
  protected getHeaders(apiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {};

    if (apiKey) {
      const raw = String(apiKey).trim();
      const bearer = raw.toLowerCase().startsWith('bearer ') ? raw : `Bearer ${raw}`;
      headers['Authorization'] = bearer;
      headers['x-api-key'] = raw;
    }

    headers['Content-Type'] = 'application/json';
    headers['Accept'] = 'application/json';
    return headers;
  }


private httpAgent = new http.Agent({ keepAlive: true, timeout: 6000000 });
private httpsAgent = new https.Agent({ keepAlive: true, timeout: 6000000 });

  /** Fetch wrapper with timeout support */
  private async fetch(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout);

    // Determine if target is HTTP or HTTPS
    const isHttps = url.startsWith('https');

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        // @ts-ignore - Pass raw node agents to bypass VS Code's defaults
        agent: isHttps ? this.httpsAgent : this.httpAgent
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Send a non-streaming chat completion request and return the full response. */
  public async completeChat(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse> {
    const url = `${this.config.serverUrl}/v1/chat/completions`;

    const apiKey = await SecretManager.getClientApiKey();
    try {
      const response = await this.fetchWithRetry(url, {
        method: 'POST',
        headers: this.getHeaders(apiKey),
        body: JSON.stringify({ ...request, stream: false }),
      }, 'Complete chat');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new GatewayError(
          `Chat completion failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status,
          this.isRetryableError(null, response.status)
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof GatewayError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new GatewayError(
          `Failed to complete chat: ${error.message}`,
          undefined,
          this.isRetryableError(error),
          error
        );
      }
      throw error;
    }
  }
}
