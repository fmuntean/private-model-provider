/**
 * LMStudioClient — IllmClient implementation for LM Studio's REST API.
 *
 * References:
 *   Chat completions: https://lmstudio.ai/docs/developer/rest/chat
 *   Streaming events:  https://lmstudio.ai/docs/developer/rest/streaming-events
 *   Models endpoint:   https://lmstudio.ai/docs/developer/rest/models
 *
 * Uses LM Studio's native /api/v1/ endpoints for chat and models.
 * SSE streaming follows the OpenAI-compatible chunk format that LM Studio emits.
 */

import {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIModelsResponse,
} from '../types';
import { IllmClient, StreamChunk, StreamingToolCall, IllmClientConfig } from './interfaces';
import { LlmClient } from './llmClient';
import { SecretManager } from '../secretManager';

export class LMStudioClient extends LlmClient {
  constructor(config: IllmClientConfig) {
    super(config);
  }

  /** Fetch models via LM Studio's /api/v1/models endpoint. */
  public async fetchModels(): Promise<OpenAIModelsResponse> {
    const url = `${this.config.serverUrl}/api/v1/models`;
    const apiKey = await SecretManager.getClientApiKey();
    try {
      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        headers: this.getHeaders(apiKey),
      }, 'Fetch LM Studio models');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Failed to fetch LM Studio models: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to connect to LM Studio server: ${error.message}`);
      }
      throw error;
    }
  }

  /** Non-streaming chat completion via /api/v1/chat/completions. */
  public async completeChat(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse> {
    const url = `${this.config.serverUrl}/api/v1/chat/completions`;
    const apiKey = await SecretManager.getClientApiKey();
    try {
      const response = await this.fetchWithRetry(url, {
        method: 'POST',
        headers: this.getHeaders(apiKey),
        body: JSON.stringify({ ...request, stream: false }),
      }, 'LM Studio chat completion');

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `Chat completion failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to complete chat with LM Studio: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Stream chat completions via /api/v1/chat/completions with SSE.
   * Parses LM Studio's SSE event stream (data: lines) and yields StreamChunks.
   */
  public async *streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const url = `${this.config.serverUrl}/api/v1/chat/completions`;
    const apiKey = await SecretManager.getClientApiKey();

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(apiKey),
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ ...request, stream: true, stream_options: { include_usage: true } }),
    }, 'LM Studio streaming chat completion');

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Streaming chat completion failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
      );
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        if (abortSignal?.aborted) {
          await reader.cancel();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '' || trimmed.startsWith(':')) continue; // skip empty / comments

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta ?? choice.message ?? {};
              const content = delta.content ?? '';
              const reasoning_content = delta.reasoning_content ?? delta.reasoning ?? delta.thinking ?? undefined;

              // Tool calls
              const tool_calls: StreamingToolCall[] = [];
              const finished_tool_calls: StreamingToolCall[] = [];

              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  tool_calls.push({
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    arguments: tc.function?.arguments ?? '',
                  });
                }
              }

              if (choice.finish_reason === 'tool_calls' && Array.isArray(delta.tool_calls)) {
                finished_tool_calls.push(...tool_calls);
              }

              yield {
                content,
                reasoning_content,
                tool_calls,
                finished_tool_calls,
                usage: parsed.usage,
              };
            } catch {
              // skip unparseable lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
