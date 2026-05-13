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
  title?: string;
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
