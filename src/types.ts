/**
 * Centralized type definitions for the extension.
 * These types are used across the webview, extension, and provider code.
 */

/**
 * Message sent from the webview to the extension.
 */
export interface WebviewToExtensionMessage {
  command: string;
  /**
   * Optional payload depending on the command.
   */
  [key: string]: any;
}

/**
 * Message sent from the extension to the webview.
 */
export interface ExtensionToWebviewMessage {
  type: string;
  /**
   * Payload varies by type.
   */
  [key: string]: any;
}

/**
 * Configuration options for the extension.
 */
export interface ExtensionConfig {
  /**
   * The default model id to use when creating a new session.
   */
  defaultModelId?: string;
  /**
   * Maximum number of concurrent sessions.
   */
  maxConcurrentSessions?: number;
  /**
   * Whether to enable verbose logging.
   */
  verboseLogging?: boolean;
}

/**
 * Representation of a chat message.
 */
/**
 * Representation of a chat session.
 */
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatSessionMessage[];
}
/**
 * Type definitions for OpenAI-compatible API responses
 */

export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/**
 * Extends the basic OpenAI model definition with the additional fields
 * required by VS Code's {@link vscode.LanguageModelChatInformation}.
 *
 * The extension fetches models from an OpenAI‑compatible endpoint and then
 * enriches the result with configuration‑derived defaults (e.g. token limits,
 * family name, capabilities).  By defining a dedicated interface we keep the
 * mapping logic type‑safe and self‑documenting.
 */
export interface ModelInfo extends OpenAIModel {
  /** Human‑readable name of the model (used for UI dropdowns). */
  name: string;
  /** Opaque family identifier – e.g. "private-model-provider". */
  family: string;
  /** Maximum number of input tokens the model can accept. */
  maxInputTokens: number;
  /** Maximum number of tokens the model can generate. */
  maxOutputTokens: number;
  /** Model version string (e.g. "1.0.0"). */
  version: string;
  /** Capabilities supported by the model (tool calling, etc.). */
  capabilities: {
    /** Indicates whether the model supports tool calling. */
    toolCalling?: boolean;
    // Additional capability flags can be added here without breaking the type.
    [key: string]: any;
  };
  /** Optional tooltip displayed in the UI when hovering the model. */
  tooltip?: string;
  /** Optional detail string rendered alongside the model name. */
  detail?: string;
}

export interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface OpenAIChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface OpenAIChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

/**
 * Partial chunk of a streamed chat response used by the webview.
 * Mirrors the shape expected by `streamMessage` callbacks in `provider.ts`.
 */
export interface MessageChunk {
  /**
   * The type of the chunk – typically omitted for plain text chunks.
   * When present it can be used by the UI to differentiate between
   * regular content, tool calls, tool results, etc.
   */
  type?: string;
  /**
   * The textual content of the chunk, if any.
   */
  content?: string;
  /**
   * Indicates whether this is the final chunk of the stream.
   */
  done?: boolean;
  /**
   * Usage information returned by the model (prompt/completion token counts).
   */
  usage?: any;
  /**
   * Flag set when the stream was cancelled by the user.
   */
  cancelled?: boolean;

  name?: string;
  id?: string;
  arguments? : string;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Message types for chat sessions
 */
export type ChatMessageType = 'prompt' | 'context' | 'user' | 'agent' | 'tools';

/**
 * Token usage breakdown by message type
 */
export interface TokenUsageByType {
  prompt: number;
  context: number;
  user: number;
  agent: number;
  tools: number;
}

/**
 * Token usage for a chat session
 */
export interface SessionTokenUsage {
  byType: TokenUsageByType;
  total: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * A single message in a chat session
 */
export interface ChatSessionMessage {
  id: string;
  type: ChatMessageType;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  modelId?: string; // Track which model generated this message (for assistant messages)
  tokenEstimate?: number;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  toolCallId?: string;
}

/**
 * Chat session metadata (stored in sessions.json)
 */
export interface ChatSessionMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelId: string;
  lastUsedModel?: string; // Track the last model used in this session
  messageCount: number;
  tokenUsage: SessionTokenUsage;
}

/**
 * Full chat session with messages
 */
export interface ChatSession extends ChatSessionMetadata {
  messages: ChatSessionMessage[];
}

/**
 * Session manager events
 */
export interface SessionManagerEvent {
  type: 'created' | 'deleted' | 'updated' | 'switched';
  sessionId: string;
}

export interface GatewayConfig {
  serverUrl: string;
  apiKey?: string;
  requestTimeout: number;
  defaultMaxTokens: number;
  defaultMaxOutputTokens: number;
  enableToolCalling: boolean;
  parallelToolCalling: boolean;
  agentTemperature: number;
  // New extended options
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  maxRetries: number;
  retryDelayMs: number;
  modelCacheTtlMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
