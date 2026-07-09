import { AIRequest, AIResponse, APIConverter, FinishReason, ToolCall } from "./chatMessages";

// Approximate types expected by Google's native @google/genai SDK
interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // Base64 encoding only
  };
  functionCall?: {
    name: string;
    args: Record<string, any>;
  };
}

interface GeminiContent {
  role: 'user' | 'model'; // Gemini doesn't use "assistant" or inline "system" here
  parts: GeminiPart[];
}

export interface GeminiRequest {
  model: string;
  contents: GeminiContent[];
  systemInstruction?: {
    parts: [{ text: string }];
  };
  config?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    stopSequences?: string[];
    responseMimeType?: 'text/plain' | 'application/json';
    tools?: Array<{
      functionDeclarations?: Array<{
        name: string;
        description: string;
        parameters: any;
      }>;
    }>;
  };
}

export interface GeminiResponse {
  candidates?: Array<{
    content?: {
      role: 'model';
      parts?: GeminiPart[];
    };
    finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}



export class GeminiConverter implements APIConverter<GeminiRequest, GeminiResponse> {

  toProviderRequest(request: AIRequest): GeminiRequest {
    const { messages, options } = request;

    // 1. Extract system instructions. Like Anthropic, Gemini holds system contexts natively at the root.
    const systemMessages = messages.filter(m => m.role === 'system');
    let systemInstruction: GeminiRequest['systemInstruction'] | undefined;

    if (systemMessages.length > 0) {
      const combinedSystemText = systemMessages
        .map(m => typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('\n'))
        .join('\n\n');
      
      systemInstruction = {
        parts: [{ text: combinedSystemText }]
      };
    }

    // 2. Map standard conversation threads to 'user' or 'model' roles
    const geminiContents: GeminiContent[] = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        // Map universal "assistant" keyword over to Google's strict "model" role
        const role = m.role === 'assistant' ? 'model' : 'user';

        if (typeof m.content === 'string') {
          return { role, parts: [{ text: m.content }] };
        }

        // Map rich media blocks (TextPart | ImagePart) into distinct native part definitions
        const parts: GeminiPart[] = m.content.map(part => {
          if (part.type === 'text') {
            return { text: part.text };
          }

          // Strip typical DataURI header details if present, keeping only pure base64 bytes
          const base64Data = part.data.includes('base64,')
            ? part.data.split('base64,')[1]
            : part.data;

          return {
            inlineData: {
              mimeType: part.mimeType,
              data: base64Data
            }
          };
        });

        return { role, parts };
      });

    // 3. Re-structure standard functional declarations into Google tool syntax array
    let geminiTools: any[] | undefined = undefined;
    if (options.tools && options.tools.length > 0) {
      geminiTools = [{
        functionDeclarations: options.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }))
      }];
    }

    // 4. Group all parameters into the internal config wrapper block
    const geminiConfig: GeminiRequest['config'] = {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens, // Maps maxTokens into maxOutputTokens
      tools: geminiTools,
      ...options.providerOptions // Escape hatch for safetySettings, search Grounding, etc.
    };
    
    geminiConfig.responseMimeType = 'application/json';
    
    return {
      model: options.model,
      contents: geminiContents,
      systemInstruction,
      config: geminiConfig
    };
  }

  fromProviderResponse(response: GeminiResponse): AIResponse {
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // 1. Gather texts and evaluate tool requests emitted across parts
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        text += part.text;
      }
      // Gemini returns function args parsed as real JS objects automatically
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini_call_${Math.random().toString(36).substring(2, 9)}`, // Generate synthetic ID since Gemini lacks native call IDs
          name: part.functionCall.name,
          arguments: part.functionCall.args
        });
      }
    }

    // 2. Transition finish conditions over to our universal enum types
    let finishReason: FinishReason = 'stop';
    if (candidate?.finishReason === 'MAX_TOKENS') finishReason = 'length';
    if (candidate?.finishReason === 'SAFETY') finishReason = 'content_filter';
    if (toolCalls.length > 0) finishReason = 'tool_call';

    // 3. Standardize token tracking metrics names
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    const totalTokens = response.usageMetadata?.totalTokenCount ?? 0;

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens
      }
    };
  }
}
