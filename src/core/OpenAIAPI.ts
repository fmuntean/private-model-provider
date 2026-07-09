



// Approximate types expected by OpenAI's SDK
export interface OpenAIMessage {
  role: MessageRole;
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string }; // Notice this is a raw string!
  }>;
}


export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop_sequences?: string[];
  tools?: OpenAITool[];
  response_format?: { type: 'json_object' | 'text' };
}

export interface OpenAIResponse {
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}


import { 
  AIRequest, 
  AIResponse, 
  ToolCall, 
  APIConverter, 
  MessageRole,
  FinishReason,
  ImagePart
} from './chatMessages'; // Assuming types match our universal definitions


export class OpenAIConverter implements APIConverter<OpenAIRequest, OpenAIResponse> {
  
    toProviderRequest(request: AIRequest): OpenAIRequest {
    const { messages, options } = request;

    // 1. OpenAI keeps system messages inline within the primary array
    const openAIMessages: OpenAIMessage[] = messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }

      // Convert our unified parts layout into OpenAI's image_url object format
      const content = m.content.map(part => {
        if (part.type === 'text') {
          return { type: 'text' as const, text: part.text };
        }

        // OpenAI handles base64 directly inline via data URIs or standard URLs
        const data = (part as ImagePart).data
        const url = data.startsWith('http') ? data : `data:${(part as ImagePart).mimeType};base64,${data}`;

        return {
          type: 'image_url' as const,
          image_url: { url }
        };
      });

      return { role: m.role, content };
    });

    // 2. OpenAI requires wrapping tool JSON schemas inside a "function" descriptor object
    const openAITools = options.tools?.map(tool =>( {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }) );

    // 3. Translate general configurations into OpenAI variables
    const openAIRequest: OpenAIRequest = {
      model: options.model,
      messages: openAIMessages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      tools: openAITools,
      ...options.providerOptions // Escape hatch for extra parameters (e.g. seed, user, etc.)
    };

    // 4. Handle response format configurations cleanly
    if (options.providerOptions?.response_format === 'json') {
      openAIRequest.response_format = { type: 'json_object' };
    }

    return openAIRequest;
  }

  fromProviderResponse(response: OpenAIResponse): AIResponse {
    const choice = response.choices[0];
    const message = choice.message;

    // 1. Text extraction
    const text = message.content || '';

    // 2. Safely parse stringified function arguments into native JS objects
    let toolCalls: ToolCall[] | undefined;
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map(tc => {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch {
          // Fallback if the model emitted malformed or truncated JSON
          parsedArgs =  {_rawMalformedArguments: tc.function.arguments };
        }

        return {
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs
        } as ToolCall;
      });
    }

    // 3. Normalize completion end markers to our standard internal types
    let finishReason: FinishReason = 'stop';
    if (choice.finish_reason === 'length') finishReason = 'length';
    if (choice.finish_reason === 'tool_calls') finishReason = 'tool_call';
    if (choice.finish_reason === 'content_filter') finishReason = 'content_filter';

    // 4. Normalize execution token usage metrics
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = response.usage?.total_tokens ?? 0;

    return {
      text,
      toolCalls,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens
      }
    } as AIResponse;
  }
}
