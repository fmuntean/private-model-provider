import { 
  AIRequest, 
  AIResponse, 
  Message, 
  ToolCall, 
  FinishReason, 
  APIConverter 
} from './chatMessages'; // Assuming types are in a file named types.ts


// Approximate types expected by Anthropic's SDK
interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  >;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessageParam[];
  system?: string; // System prompt lives here, not in messages!
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<{ name: string; description: string; input_schema: any }>;
}

interface AnthropicResponse {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  >;
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}




export class AnthropicConverter implements APIConverter<AnthropicRequest, AnthropicResponse> {
  
  toProviderRequest(request: AIRequest): AnthropicRequest {
    const { messages, options } = request;

    // 1. Anthropic requires system prompts at the top level, not in the message array.
    const systemMessages = messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages
      .map(m => typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('\n'))
      .join('\n\n') || undefined;

    // 2. Filter out system messages and map user/assistant messages to Anthropic's format
    const anthropicMessages: AnthropicMessageParam[] = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        // Ensure role names match ('assistant' or 'user')
        const role = m.role === 'assistant' ? 'assistant' : 'user';

        if (typeof m.content === 'string') {
          return { role, content: m.content };
        }

        // Map universal parts to Anthropic's block format
        const content = m.content.map(part => {
          if (part.type === 'text') {
            return { type: 'text' as const, text: part.text };
          }
          
          // Anthropic expects image parts wrapped in a 'source' object
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: part.mimeType,
              data: part.data
            }
          };
        });

        return { role, content };
      });

    // 3. Map tools over to Claude's 'input_schema' format
    const anthropicTools = options.tools?.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters // Our ToolProperty maps 1:1 to standard JSON schemas
    }));

    // 4. Construct final payload, pulling in optional custom values as an escape hatch
    return {
      model: options.model,
      messages: anthropicMessages,
      system: systemPrompt,
      max_tokens: options.maxTokens ?? 4096, // Anthropic requires max_tokens
      temperature: options.temperature,
      tools: anthropicTools,
      ...options.providerOptions // Spreads vendor-specific configurations like "thinking" budgets
    };
  }

  fromProviderResponse(response: AnthropicResponse): AIResponse {
    // 1. Separate plain text responses from requested tool call objects
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input // Anthropic returns tool inputs pre-parsed as an object
        });
      }
    }

    // 2. Map Anthropic's unique stop reasons back to our unified finish reasons
    let finishReason: FinishReason = 'stop';
    if (response.stop_reason === 'max_tokens') finishReason = 'length';
    if (response.stop_reason === 'tool_use') finishReason = 'tool_call';

    // 3. Map token usage metrics
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    } as AIResponse;
  }
}
