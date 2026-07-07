/**
 * GeminiClient – Google Gemini Interactions API client.
 *
 * This client wraps the Google Gemini Interactions API
 * (generativelanguage.googleapis.com/v1) in the same public interface as
 * the OpenAI-compatible LlmClient, so the two can be used interchangeably
 * throughout the extension.
 *
 * All public methods (constructor, updateConfig, fetchModels,
 * streamChatCompletion, completeChat, MaxRetries, RetryDelayMs) match the
 * LlmClient signature exactly.
 *
 * ── Key differences from an OpenAI-compatible server ──────────────────────
 *
 * The Interactions API uses a SINGLE unified endpoint for both streaming and
 * non‑streaming requests, controlled by a `stream` boolean in the request
 * body.  This replaces the old pattern of separate endpoints:
 *
 *    POST /v1/interactions          ← streaming AND non‑streaming
 *          (with {"stream": true} in body for streaming)
 *
 * Authentication is via the `x-goog-api-key` header (or the `?key=` query
 * parameter).  The API key is the same key obtained from Google AI Studio.
 *
 * The request body uses the Interactions resource schema:
 *   - model       (e.g. "models/gemini-2.0-flash")
 *   - agent      (optional, e.g. "private-model-provider-vscode")  
 *   - input       (array of content blocks, e.g. [{"type": "text", "text": "..."}])
 *  - system_instruction  (separate from contents)
 *   - tools       (function declarations)
 *   - generation_config   (temperature, max_output_tokens, etc.)
 *   - stream      (boolean – true for SSE streaming)
 *
 * API reference:
 *   https://ai.google.dev/static/api/interactions-v1.md.txt
 *   https://ai.google.dev/api/interactions-api
 *   https://ai.google.dev/gemini-api/docs/interactions-overview
 *   https://ai.google.dev/gemini-api/docs/interactions/quickstart
 *   https://ai.google.dev/gemini-api/docs/api-key
 */

import * as gemini from './geminiTypes';

import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIModelsResponse,
  OpenAITool,
} from '../types';
import { IllmClient, StreamChunk, StreamingToolCall, IllmClientConfig } from './interfaces';
import { SecretManager } from '../secretManager';

// Gemini-related types are defined inside geminiClient.ts

// ---------------------------------------------------------------------------
// Internal Gemini / Interactions type definitions
// ---------------------------------------------------------------------------

/** A single part inside a Gemini Content. */
interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}



interface GeminiStep {
  type: 'function_call' | 'tool_call';
  tool_calls: GeminiFunctionDeclaration[];
}

/** Gemini tool / function declaration. */
interface GeminiFunctionDeclaration {
  type: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface GeminiTool extends GeminiFunctionDeclaration {
}

/** Gemini generation config. */
interface GeminiGenerationConfig {
  temperature?: number;
  max_output_tokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
}

/** Request body for the Interactions API. */
interface InteractionsCreateRequest {
  model: string;
  input?: gemini.Content | gemini.Content[] | GeminiStep[] | string; // Array of content blocks (e.g., [{\"type\": \"text\", \"text\": \"...\"}])
  system_instruction?: string;
  tools?: GeminiTool[];
  generation_config?: GeminiGenerationConfig;
  stream?: boolean;
  store?: boolean;
  previous_interaction_id?: string;
  background?: boolean;
}

/** Gemini response candidate. */
interface GeminiCandidate {
  index: number;
  content: gemini.Content;
  finish_reason?: string;
}

/** Gemini usage metadata. */
interface GeminiUsageMetadata {
  prompt_token_count: number;
  candidates_token_count: number;
  total_token_count: number;
}

/** Gemini response (inside the Interaction resource). */
interface GeminiInteractionResponse {
  candidates?: GeminiCandidate[];
  usage_metadata?: GeminiUsageMetadata;
}

/** Interaction resource returned by the Interactions API. */
interface GeminiInteraction {
  id: string;
  model: string;
  create_time?: string;
  update_time?: string;
  response?: GeminiInteractionResponse;
  state?: 'ACTIVE' | 'COMPLETED' | 'FAILED';
}

/** Model metadata returned by the Gemini /models endpoint. */
interface GeminiModel {
  name: string;
  version: string;
  display_name: string;
  description: string;
  input_token_limit: number;
  output_token_limit: number;
  supportedGenerationMethods: string[];
}

interface GeminiModelsResponse {
  models: GeminiModel[];
}

type GeminiProperty = {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string; description?: string };
  properties?: Record<string, GeminiProperty>;
  required?: string[];
};

type GeminiFunctionSchema = {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, GeminiProperty>;
    required?: string[];
  };
};

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

interface RetryConfig {
  max_retries: number;
  base_delay_ms: number;
  max_delay_ms: number;
  retryable_status_codes: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  max_retries: 3,
  base_delay_ms: 1000,
  max_delay_ms: 10000,
  retryable_status_codes: [429, 500, 502, 503, 504],
};

// ---------------------------------------------------------------------------
// Error class (same shape as LlmClient's GatewayError)
// ---------------------------------------------------------------------------

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status_code?: number,
    public readonly is_retryable: boolean = false,
    public readonly original_error?: Error
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

// ---------------------------------------------------------------------------
// Streaming tool-call state (private to this class)
// ---------------------------------------------------------------------------

interface ToolCallState {
  tool_calls_by_index: Map<number, StreamingToolCall>;
  finalized_indices: Set<number>;
  request_id: string;
  tool_call_counter: number;
  last_usage?: StreamChunk['usage'];
}

interface ParsedChunk {
  delta?: {
    type?: string;
    text?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  message?: {
    content?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string;
  id?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * HTTP client for the Google Gemini Interactions API, matching the LlmClient
 * interface exactly.
 *
 * Internally, OpenAI-format requests are translated to the Interactions API
 * request schema, and Interactions responses are translated back to the
 * OpenAI-compatible shape that the rest of the extension expects.
 */
export class GeminiClient implements IllmClient {
  private config: IllmClientConfig;
  private retryConfig: RetryConfig;

  /** Base URL for the Gemini API. */
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1';

  constructor(config: IllmClientConfig, retryConfig?: Partial<RetryConfig>) {
    this.config = config;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /** Update client configuration. */
  public updateConfig(config: IllmClientConfig): void {
    this.config = config;
  }

  public MaxRetries(): number {
    return this.retryConfig.max_retries;
  }

  public RetryDelayMs(): number {
    return this.retryConfig.base_delay_ms;
  }

  // -----------------------------------------------------------------------
  // Models
  // -----------------------------------------------------------------------

  /**
   * Fetch available models from Gemini.
   *
   * The Interactions API uses the same `GET /v1/models` endpoint as the
   * old generateContent API.  Models are filtered to only those that support
   * `generateContent` and the response is mapped to the OpenAI shape.
   */
  public async fetchModels(): Promise<OpenAIModelsResponse> {
    const url = `${this.baseUrl}/models`;

    try {
      const response = await this.fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: await this.getHeaders(),
        },
        'Fetch Gemini models'
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new GeminiError(
          `Failed to fetch Gemini models: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status,
          this.isRetryableError(null, response.status)
        );
      }

      const geminiResp: GeminiModelsResponse = await response.json();

      // Translate to OpenAI shape – filter to only models supporting generateContent.
      const data = (geminiResp.models || [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => ({
          id: m.name.replace(/^models\//, ''), // strip "models/" prefix
          object: 'model' as const,
          created: 0,
          owned_by: 'google',
        }));

      return { object: 'list', data };
    } catch (error) {
      if (error instanceof GeminiError) throw error;
      if (error instanceof Error) {
        throw new GeminiError(
          `Failed to connect to Gemini API: ${error.message}`,
          undefined,
          this.isRetryableError(error),
          error
        );
      }
      throw error;
    }
  }

  /**
   * LM Studio model endpoint is not applicable to Gemini.
   * Returns an empty response for compatibility.
   */
  public async fetchLMStudioModels(): Promise<any> {
    //return { object: 'list', data: [] };
    throw new Error('fetchLMStudioModels is not supported for GeminiClient');
  }

  // -----------------------------------------------------------------------
  // Non‑streaming chat
  // -----------------------------------------------------------------------

  /**
   * Send a non‑streaming chat completion request to the Interactions API and
   * return the full response translated into OpenAI shape.
   */
  public async completeChat(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    const body = this.buildInteractionsCreateRequest(request, false);

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/interactions`,
        {
          method: 'POST',
          headers: await this.getHeaders(),
          body: JSON.stringify(body),
        },
        'Complete chat (Gemini Interactions)'
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new GeminiError(
          `Gemini chat completion failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status,
          this.isRetryableError(null, response.status)
        );
      }

      const interaction: GeminiInteraction = await response.json();

      return this.translateNonStreamingResponse(interaction, request.model);
    } catch (error) {
      if (error instanceof GeminiError) throw error;
      if (error instanceof Error) {
        throw new GeminiError(
          `Failed to complete chat via Gemini: ${error.message}`,
          undefined,
          this.isRetryableError(error),
          error
        );
      }
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Streaming chat
  // -----------------------------------------------------------------------

  /**
   * Stream chat completions from the Gemini Interactions API via SSE.
   *
   * Streaming is enabled by setting `{\"stream\": true}` in the request body.
   * The response is an SSE stream of Interaction resources (or partial chunks
   * depending on the backend).
   *
   * Yields the same shape as LlmClient.streamChatCompletion so that callers
   * are agnostic to which backend is in use.
   */
    public async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    abortSignal?: AbortSignal
  ) {
    const body = this.buildInteractionsCreateRequest(request, true);

  
    try {
      const url = `${this.baseUrl}/interactions`;
      const controller = new AbortController();
      if (abortSignal) abortSignal.addEventListener('abort', () => controller.abort());

      const response = await this.fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: await this.getHeaders(),
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        `Stream chat completion (Gemini Interactions)`,
        abortSignal
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new GeminiError(
          `Gemini streaming failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
          response.status,
          this.isRetryableError(null, response.status)
        );
      }

      let currentEventType: string | null = null;
      let buffer = '';
      const textDecoder = new TextDecoder('utf-8');

      for await (const chunk of response.body!) {
        buffer += textDecoder.decode(chunk, { stream: true });

        let lastNewlineIndex;
        while ((lastNewlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, lastNewlineIndex);
          buffer = buffer.substring(lastNewlineIndex + 1);

          if (!line.trim()) continue;

          if (line.startsWith('event:')) {
            currentEventType = line.slice('event:'.length).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const jsonString = line.slice('data:'.length).trim();
              const parsed: ParsedChunk = JSON.parse(jsonString);
              yield this.translateStreamingChunk(currentEventType, parsed, request.model);
            } catch (e) {
              // Skip malformed chunks.
            }
          } else if (line.startsWith('{')) {
            try {
              const parsed: ParsedChunk = JSON.parse(line);
              yield this.translateStreamingChunk(currentEventType, parsed, request.model);
            } catch (e) {
              // Skip malformed chunks.
            }
          }
        }
      }

      // Process any remaining data in the buffer after the stream ends.
      if (buffer.trim()) {
        const line = buffer;
        if (line.startsWith('event:')) {
          currentEventType = line.slice('event:'.length).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const jsonString = line.slice('data:'.length).trim();
            const parsed: ParsedChunk = JSON.parse(jsonString);
            yield this.translateStreamingChunk(currentEventType, parsed, request.model);
          } catch (e) {
            // Skip malformed chunks.
          }
        } else if (line.startsWith('{')) {
          try {
            const parsed: ParsedChunk = JSON.parse(line);
            yield this.translateStreamingChunk(currentEventType, parsed, request.model);
          } catch (e) {
            // Skip malformed chunks.
          }
        }
      }

    } catch (error) {
      if (error instanceof GeminiError) throw error;
      if (error instanceof Error) {
        throw new GeminiError(
          `Failed to stream chat via Gemini: ${error.message}`,
          undefined,
          this.isRetryableError(error),
          error
        );
      }
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Private helper methods
  // -----------------------------------------------------------------------

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    description: string,
    abortSignal?: AbortSignal
  ): Promise<Response> {
    let response;
    for (let i = 0; i < this.retryConfig.max_retries; i++) {
      try {
        response = await fetch(url, options);
        break;
      } catch (e) {
        if (e instanceof Error && e.message === 'Failed to fetch') continue;
        throw e;
      }

      const delay = Math.min(
        this.retryConfig.base_delay_ms * Math.pow(2, i),
        this.retryConfig.max_delay_ms
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    if (!response?.ok) {
      throw new GeminiError(
        `${description} failed: ${response?.status} ${response?.statusText}`,
        response?.status,
        this.isRetryableError(null, response?.status)
      );
    }

    return response;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const apiKey = await SecretManager.getGeminiApiKey();
    if (!apiKey) throw new Error('API key not found');
    return { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' };
  }

  private isRetryableError(error?: unknown, status?: number): boolean {
    if (error instanceof GeminiError && error.is_retryable) return true;
    if (status !== undefined) return this.retryConfig.retryable_status_codes.includes(status);
    return false;
  }

  /** Build the Interactions API request body from an OpenAI-format request. */
  private buildInteractionsCreateRequest(
    request: OpenAIChatCompletionRequest,
    stream: boolean
  ): InteractionsCreateRequest {
    const model = request.model || 'models/gemini-2.5-flash';

    // Translate messages to content blocks.
    const contents: gemini.Content[] = request.messages.map((msg) => ({
      type: 'text',
      text: msg.content as string,
    }));

    // Build input array per Interactions spec.
    let input: gemini.Content | gemini.Content[] | string = contents;

    const input_text = contents.slice(1).map(msg => (msg as gemini.TextContent)?.text ?? '').join('\n'); // Exclude the first message (system instruction) from input

    let tools: gemini.Tool[] =  this.cleanToolsForGemini(this.mapTools(request.tools || []));

    return {
      model,
      input: input_text, // Exclude the first message (system instruction) from input
      system_instruction: (contents[0] as gemini.TextContent)?.text,
      tools:tools,
      //generation_config: this.mapGenerationConfig(request),
      stream: stream,
      store: false,
      background: false,
    };
  }

  /** Map OpenAI tools to Interactions Tool objects. */
  private mapTools(tools?: OpenAITool[]): gemini.Tool[] {
    if (!tools) return [];

    const mapped: gemini.Tool[] = [];
    for (const tool of tools) {
      switch (tool.type) {
        case 'function':
          mapped.push({
            type: 'function',
            name: tool.function.name,
            description: tool.function.description || '',
            parameters: tool.function.parameters,
          });
          break;

        default:
          // Built-in tools are not directly exposed in the OpenAI interface.
          // If needed, they can be added here as special cases.
      }
    }

    return mapped;
  }

  /** Map generation config to Interactions format. */
  private mapGenerationConfig(request: OpenAIChatCompletionRequest): gemini.GenerationConfig | undefined {
    if (!request.temperature) return;

    return {
      temperature: request.temperature,
      max_output_tokens: request.max_tokens ?? 4096,
      top_p: request.top_p ?? 1.0,
      frequency_penalty: request.frequency_penalty ?? 0.0,
      presence_penalty: request.presence_penalty ?? 0.0,
    };
  }

  /** Translate a non-streaming Interactions response to OpenAI shape. */
  private translateNonStreamingResponse(
    interaction: GeminiInteraction,
    model: string
  ): OpenAIChatCompletionResponse {
    const candidates = interaction.response?.candidates;
    if (!candidates || candidates.length === 0) return {
      id: interaction.id,
      model: model,
      object: 'chat.completion',
      created: interaction.create_time ? Date.parse(interaction.create_time) / 1000 : 0,
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };

    const content = (candidates[0].content as gemini.TextContent)?.text ?? '';
    const finishReason = candidates[0].finish_reason ?? 'stop';

    return {
      id: interaction.id,
      object: 'chat.completion',
      created: interaction.create_time ? Date.parse(interaction.create_time) / 1000 : 0,
      model: model,
      choices: [{
        index: candidates[0].index,
        message: { role: 'assistant', content: content },
        finish_reason: finishReason
      }],
    };
  }

  /** Translate a streaming chunk to OpenAI shape. */
  private translateStreamingChunk(event: string|null, chunk: ParsedChunk, model: string): StreamChunk {
    const content = (chunk.delta?.text ?? chunk.delta?.content ?? chunk.message?.content) || '';
    const finishReason = chunk.finish_reason ?? 'stop';

    return {
      content: content,
      reasoning_content: event=='reasoning' ? chunk.delta?.reasoning_content ?? '' : '',
      tool_calls: (chunk.delta?.tool_calls ?? chunk.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id ?? '',
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '',
      })),
      finished_tool_calls: finishReason === 'stop' ? (chunk.delta?.tool_calls ?? chunk.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id ?? '',
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '',
      })) : [],
      usage: chunk.usage ? {prompt_tokens: chunk.usage.prompt_tokens, completion_tokens: chunk.usage.completion_tokens, total_tokens: chunk.usage.total_tokens }: undefined
    };
  }

  /**
 * Cleans up an array of OpenAI-style tool schemas to ensure strict compatibility 
 * with the Gemini Interactions/Structured Outputs API.
 */
  private cleanToolsForGemini(rawTools: any[]): GeminiFunctionSchema[] {
  return rawTools.map((tool) => {
    // 1. Ensure top-level structure is a function tool declaration
    const cleanedTool: GeminiFunctionSchema = {
      type: "function",
      name: tool.name || "",
      description: tool.description || "",
      parameters: {
        type: "object",
        properties: {},
        required: Array.isArray(tool.parameters?.required) ? tool.parameters.required : []
      }
    };

    const rawProperties = tool.parameters?.properties || {};

    // 2. Iterate and sanitize individual properties
    for (const [key, value] of Object.entries(rawProperties)) {
      if (!value || typeof value !== "object") continue;

      let prop = { ...value } as any;

      // Clean up unsupported validation fields or comments
      delete prop.$comment;
      delete prop.enumDescriptions;

      // Handle raw `anyOf` blocks by reducing them to a basic string property
      // and appending the alternative choices to the description field
      if (prop.anyOf && Array.isArray(prop.anyOf)) {
        const descriptions = prop.anyOf
          .map((choice: any, index: number) => `Option ${index + 1} (${choice.type}): ${choice.description || ""}`)
          .join(" | ");
        
        prop.type = "string";
        prop.description = `${prop.description || ""} [Accepts: ${descriptions}]`.trim();
        delete prop.anyOf;
      }

      // Gemini requires an explicit type attribute for every single property
      if (!prop.type) {
        prop.type = "string"; // Safe fallback default for text/untyped properties
      }

      // If it's an array, ensure the item configurations are clean too
      if (prop.type === "array" && prop.items) {
        prop.items = {
          type: prop.items.type || "string",
          ...(prop.items.description ? { description: prop.items.description } : {})
        };
      }

      cleanedTool.parameters.properties[key] = prop;
    }

    return cleanedTool;
  });
  }
}
