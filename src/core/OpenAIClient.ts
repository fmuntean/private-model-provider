import { IllmClientConfig } from './interfaces';
import { AIProviderClient, AIRequest, AIResponse, StreamChunk } from './chatMessages';
import { OpenAIConverter } from './OpenAIAPI';
import { LlmClient } from './llmClient';

export class OpenAIClient implements AIProviderClient {
  public providerName: 'openai' = 'openai';
  private llmClient: LlmClient;
  private converter: OpenAIConverter;

  constructor(config: IllmClientConfig) {
    this.llmClient = new LlmClient(config);
    this.converter = new OpenAIConverter();
  }

  public async complete(request: AIRequest): Promise<AIResponse> {
    const openaiRequest = this.converter.toProviderRequest(request);
    const openaiResponse = await this.llmClient.completeChat(openaiRequest);
    return this.converter.fromProviderResponse(openaiResponse);
  }

  public async *stream(request: AIRequest): AsyncIterable<StreamChunk> {
    const openaiRequest = this.converter.toProviderRequest(request);
    const stream = this.llmClient.streamChatCompletion(openaiRequest);

    for await (const chunk of stream) {
      // The LlmClient's StreamChunk is already compatible with our unified StreamChunk
      // However, we need to map the tool_calls and finished_tool_calls to the unified format
      // The LlmClient returns StreamingToolCall, which is Partial<ToolCall>
      yield {
        text: chunk.content || '',
        toolCalls: chunk.tool_calls,
        finishReason: chunk.finishReason,
      };
    }
  }
}
