// Placeholder interfaces for abstraction layers. These will be fleshed out later.
export interface IConfigProvider {
  get<T>(key: string, defaultValue?: T): T;
}

export interface IFileSystem {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface ISecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IStatisticsReporter {
  report(stats: any): void;
}

export interface ICommandRegistry {
  register(name: string, handler: (...args: any[]) => any): void;
}

/**
 * Minimal output channel abstraction used by the VS Code logger.
 * It mirrors the subset of vscode.OutputChannel methods that the
 * logger needs (appendLine, show, clear, dispose). Implementations
 * can wrap the real VS Code OutputChannel or provide a console‑based
 * fallback for CLI usage.
 */
export interface IOutputChannel {
  /** Append a line of text to the channel */
  appendLine(value: string): void;
  /** Show the channel (no‑op for CLI) */
  show(preserveFocus?: boolean): void;
  /** Clear the channel (no‑op for CLI) */
  clear(): void;
  /** Dispose any resources */
  dispose(): void;
}

/**
 * Minimal logger abstraction used by both VS Code and CLI implementations.
 * This interface deliberately avoids any VS Code specific types so that it
 * can be used in the core layer without pulling in the VS Code API.
 */
export interface ILogger {
  /** Log an informational message */
  info(message: string): void;
  /** Log a warning message */
  warn(message: string): void;
  /** Log an error message; optional error object for details */
  error(message: string, error?: unknown): void;
  /** Log a debug message */
  debug(message: string): void;
  /** Show the underlying output (no‑op for CLI) */
  show(): void;
  /** Clear the output (no‑op for CLI) */
  clear(): void;
  /** Dispose any resources */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// LLM Client configuration (shared by LlmClient and GeminiClient)
// ---------------------------------------------------------------------------

import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIModelsResponse,
} from '../types';

/**
 * Configuration for an LLM client. Contains only the fields actually consumed
 * by {@link LlmClient} and {@link GeminiClient}: server URL, API key, and
 * request timeout. All other settings (temperature, retry policy, etc.) are
 * either per-request or handled internally by each client with their own defaults.
 */
export interface IllmClientConfig {
  /** Base URL of the inference server (e.g. `http://localhost:8000`) */
  serverUrl: string;
  /** API key for authentication, if required */
  apiKey?: string;
  /** Timeout in milliseconds for HTTP requests */
  requestTimeout: number;
}

/**
 * A single tool call accumulated during streaming.
 */
export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * The shape of each chunk yielded by streamChatCompletion.
 */
export interface StreamChunk {
  content: string;
  reasoning_content?: string;
  tool_calls: StreamingToolCall[];
  finished_tool_calls: StreamingToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Common interface for LLM API clients.
 *
 * Both LlmClient (OpenAI-compatible servers) and GeminiClient (Google Gemini
 * Interactions API) implement this interface, allowing the rest of the
 * extension to swap between them transparently.
 */
export interface IllmClient {
  /** Update client configuration at runtime. */
  updateConfig(config: IllmClientConfig): void;

  /** Maximum number of retries for failed requests. */
  MaxRetries(): number;

  /** Base delay in milliseconds between retry attempts. */
  RetryDelayMs(): number;

  /** Fetch available models from the provider. */
  fetchModels(): Promise<OpenAIModelsResponse>;

  /**
   * Fetch models from LM Studio's /api/v1/models endpoint.
   * Returns an empty response for providers that don't support this.
   */
  fetchLMStudioModels(): Promise<any>;

  /**
   * Send a non‑streaming chat completion request.
   */
  completeChat(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse>;

  /**
   * Stream chat completions via SSE.
   *
   * @param request - The chat completion request.
   * @param abortSignal - Optional signal to cancel the stream.
   */
  streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk, void, unknown>;
}
