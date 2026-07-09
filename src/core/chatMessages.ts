/*
1.  Unified Message and Content TypesInstead of forcing a specific provider's format, 
    this standardizes the roles and supports both text and multimodal inputs (like images or files).
*/


export type FinishReason = 'stop' | 'length' | 'tool_call' | 'content_filter' | 'other' | string;
export type MessageRole = 'system' | 'user' | 'assistant' | 'context' | 'tool' | string;

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  mimeType: string; // e.g., 'image/jpeg' or 'image/png'
  data: string;     // Base64 string or public URL
}

export interface ToolPart {
  type: 'tool';
  
  tool_request: ToolCall;
  tool_response?: string; //the response might not have been provided yet thus is optional
}

// Supports multimodal inputs across OpenAI, Anthropic, and Gemini
// Can be a raw string, an array of rich parts (text + images), or an array of tool calls
export type MessageContent = string | (TextPart | ImagePart)[] | ToolPart[];

export interface Message {
  role: MessageRole;
  content: MessageContent;
}


/*
2. Unified Tool and Schema DefinitionsAll major providers support function calling, 
   but they expect the JSON Schema slightly differently. This interface uses a standard JSON Schema structure.
*/

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // Standard JSON Schema object
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown; // JSON stringified arguments
}

/*
3. Request Configuration: This interface merges the core parameters shared by all APIs 
   while allowing for a generic providerOptions object to pass vendor-specific flags 
   (like Anthropic's reasoning tokens or OpenAI's structured output settings).
*/

export interface RequestOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  // Escape hatch for provider-specific features (e.g., response_format for OpenAI)
  providerOptions?: Record<string, any>;
}

export interface AIRequest {
  messages: Message[];
  options: RequestOptions;
}

/*
4. Unified Response and Usage DefinitionsThis standardizes what you get back, 
   including token counts (essential for logging and billing tracking) and tool execution requests.
*/
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number; // Supported by Anthropic and OpenAI
}

export interface AIResponse {
  text: string;
  toolCalls?: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
}


/*
5. The Provider InterfaceThis defines how a standard client implementation should look, 
   supporting both standard blocking requests and real-time streaming chunks.
*/
export interface StreamChunk {
  text: string;
  toolCalls?: Partial<ToolCall>[];
  finishReason?: string | null;
}

export interface AIProviderClient {
  providerName: 'openai' | 'anthropic' | 'gemini' | string; // Allow for future providers
  
  // Standard execution
  complete(request: AIRequest): Promise<AIResponse>;
  
  // Streaming execution
  stream(request: AIRequest): AsyncIterable<StreamChunk>;
}

/*
6. Type-Safe Converter SignaturesTo tie it together, 
   here is how you would type the standalone transformation functions that handle the differences across APIs:
*/
export interface APIConverter<TargetRequest, TargetResponse> {
  // Translates your clean, universal type into the exact SDK format
  toProviderRequest(request: AIRequest): TargetRequest;
  
  // Translates the exact SDK response back into your clean, universal format
  fromProviderResponse(response: TargetResponse): AIResponse;
}

export interface SessionMessage extends Message {
  toolCalls?: ToolCall[];
  finishReason?: FinishReason;
}

export class AISession {
  public messages: SessionMessage[] = [];

  addRequest(request: AIRequest): void {
    request.messages.forEach(msg => this.messages.push({ ...msg }));
  }

  addResponse(response: AIResponse): void {
    this.messages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
      finishReason: response.finishReason,
    });
  }

  addStreamChunk(chunk: StreamChunk): void {
    const lastMessage = this.messages[this.messages.length - 1];

    if (!lastMessage || lastMessage.role !== 'assistant') {
      // Start a new assistant message if the last one is not an assistant message
      this.messages.push({
        role: 'assistant',
        content: chunk.text,
        toolCalls: chunk.toolCalls as ToolCall[],
        finishReason: chunk.finishReason || undefined,
      });
    } else {
      // Append to the last assistant message
      lastMessage.content = (lastMessage.content || '') + chunk.text;
      if (chunk.toolCalls) {
        lastMessage.toolCalls = [...(lastMessage.toolCalls || []), ...(chunk.toolCalls as ToolCall[])];
      }
      if (chunk.finishReason) {
        lastMessage.finishReason = chunk.finishReason;
      }
    }
  }
}

