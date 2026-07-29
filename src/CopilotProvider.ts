/**
 * CopilotProvider — VSCode-specific implementation that extends BaseProvider.
 * This class handles the VS Code's GitHub Copilot Chat API integration, implementing
 * vscode.LanguageModelChatProvider interface for the Copilot Chat extension.
 * 
 * https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider
 */

import * as vscode from 'vscode';
import { BaseProvider } from './core/BaseProvider';
import { GatewayConfig, ModelInfo } from './types';
import { IllmClient } from './core/interfaces';
import { ILogger } from './core/interfaces';
import { AIRequest, Message, RequestOptions, ToolDefinition } from './core/chatMessages';

/**
 * CopilotProvider implements the VS Code LanguageModelChatProvider interface.
 * It provides models to Copilot Chat and streams responses back through the VSCode API.
 */
export class CopilotProvider extends BaseProvider implements vscode.LanguageModelChatProvider {
  protected cachedModels: vscode.LanguageModelChatInformation[] | null = null;
  protected modelCacheTimestamp: number = 0;
  protected readonly pendingToolCalls: Map<string, vscode.Progress<vscode.LanguageModelResponsePart>> = new Map();
  protected readonly currentToolSchemas: Map<string, unknown> = new Map();
  public readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  constructor(logger: ILogger, config: GatewayConfig, client: IllmClient) {
    super(logger, client, config);
  }

  /**
   * Provide language model information - fetches available models from inference server.
   * This method is called by Copilot Chat when the user opens a chat session or selects a model.
   * It should be fast and cache results to avoid repeated API calls.
   */

  /**
   * Clear the model cache to force a refresh
   */
  public clearModelCache(): void {
    this.cachedModels = null;
    this.modelCacheTimestamp = 0;
    this.logger.info('Model cache cleared');
    // Notify VS Code that the model list has changed
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  /**
   * Provide language model information - fetches available models from inference server
   */
  public async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    //this.logger.debug(`API key configured: ${this.config.apiKey ? 'yes' : 'no'}`);
    
    // Check cache first
    const now = Date.now();
    if (this.cachedModels && this.config.modelCacheTtlMs > 0 &&
        (now - this.modelCacheTimestamp) < this.config.modelCacheTtlMs) {
      this.logger.debug(`Using cached models (${this.cachedModels.length} models, cache age: ${now - this.modelCacheTimestamp}ms)`);
      return this.cachedModels;
    }

    // Helper to map raw model data to VS Code model info
    const mapToModelInfo = (raw: any): vscode.LanguageModelChatInformation => {
      const base: ModelInfo = {
        id: raw.id ?? raw.key ?? '',
        object: raw.object ?? 'model',
        created: raw.created ?? 0,
        owned_by: raw.publisher ?? '',
        // Fields required by VS Code
        name: raw.display_name ?? raw.key ?? '',
        family: raw.architecture ?? 'private-model-provider',
        maxInputTokens: raw.max_context_length ?? this.config.defaultMaxTokens,
        maxOutputTokens: raw.max_output_tokens ?? this.config.defaultMaxOutputTokens,
        version: raw.version ?? '1.0.0',
        capabilities: {
          toolCalling: raw.capabilities?.trained_for_tool_use ?? this.config.enableToolCalling,
          ...raw.capabilities,
        },
        tooltip: raw.description ?? '',
        detail: raw.description ?? '',
      };
      // Cast to the VS Code interface (they share the same shape)
      return base as unknown as vscode.LanguageModelChatInformation;
    };

    // Try LM Studio endpoint first
    try {
      this.logger.info('Fetching models from LM Studio endpoint...');
      const lmResponse = await this.client.fetchLMStudioModels();
      const rawModels: any[] = lmResponse?.models ?? [];
      const models: vscode.LanguageModelChatInformation[] = rawModels.map(mapToModelInfo);
      if (models.length != 0) {
        // Update cache
        this.cachedModels = models;
        this.modelCacheTimestamp = now;
        this.logger.info(`Found ${models.length} LM Studio models: ${models.map(m => m.id).join(', ')}`);
        return models;
      }
    } catch (lmError) {
      this.logger.warn(`LM Studio models fetch failed, falling back to OpenAI endpoint: ${lmError instanceof Error ? lmError.message : lmError}`);
      // Continue to fallback
    }

    // Fallback to OpenAI compatible endpoint
    try {
      this.logger.info('Fetching models from OpenAI compatible endpoint...');
      const response = await this.client.fetchModels();
      const models = response.data.map((model) => {
        const modelInfo: vscode.LanguageModelChatInformation = {
          id: model.id,
          name: model.id,
          family: 'private-model-provider',
          maxInputTokens: this.config.defaultMaxTokens,
          maxOutputTokens: this.config.defaultMaxOutputTokens,
          version: '1.0.0',
          capabilities: {
            toolCalling: this.config.enableToolCalling,
          },
          // Preserve any extra OpenAI fields for completeness
          object: model.object,
          created: model.created,
          owned_by: model.owned_by,
        } as any;
        return modelInfo as vscode.LanguageModelChatInformation;
      });
      // Update cache
      this.cachedModels = models;
      this.modelCacheTimestamp = now;
      this.logger.info(`Found ${models.length} OpenAI models: ${models.map(m => m.id).join(', ')}`);
      return models;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch models: ${errorMessage}`);
      if (!options.silent) {
        vscode.window.showErrorMessage(
          `Private Model Provider: Failed to fetch models. ${errorMessage}`,
          'Open Settings'
        ).then((selection: string | undefined) => {
          if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'private.model.provider');
          }
        });
      }
      return [];
    }
  }

  /**
   * Provide language model chat response - streams responses from inference server
   */
  public async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    this.logger.info(`Streaming chat completion for model: ${model.id}`);
    this.logger.debug(`Tool mode: ${options.toolMode}, Tools: ${options.tools?.length || 0}`);
    this.logger.debug(`Message count: ${messages.length}`);


    const cleanedMessages = messages.map(msg => {
    if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
      const thinkingRegex = /<THINKING>[\s\S]*?<\/THINKING>/gi;
      let cleanText = '';

      // Case 1: If content is passed natively as an array of structured parts
      if (Array.isArray(msg.content)) {
        cleanText = msg.content
          .map(part => {
            // Only run replacement if it's a TextPart containing value text
            if ('value' in part && typeof part.value === 'string') {
              return part.value.replace(thinkingRegex, '');
            }
            // Fallback to empty string for binary/data parts
            return '';
          }).join('');
        } 
        // Case 2: If content falls back to a primitive string string configuration
        else if (typeof msg.content === 'string') {
            cleanText = (msg.content as string).replace(thinkingRegex, '');
        }

        // Re-create the assistant message using the completely sanitized text
        return vscode.LanguageModelChatMessage.Assistant(cleanText.trim());
      }
      return msg;
    });


    // Convert messages to OpenAI format
    let aiMessages = this.toAiMessages(cleanedMessages);

    this.logger.debug(`Converted to ${aiMessages.length} AI messages`);

    // Remove unnecessary messages if the total token estimate exceeds the model's max context length
    var truncatedMessages = this.TruncateMessages(options, aiMessages);

    // TODO: optimize tools definitions to avoid sending large schemas repeatedly

    // Build request
    const request = this.toAIRequest(model, truncatedMessages, options);
    

    // Log request
    const debugRequest = JSON.stringify(request, null, 2);
    this.logger.debug(debugRequest.length > 2000 ? `Request (truncated): ${debugRequest.substring(0, 2000)}...` : `Request: ${debugRequest}`);

    let thinking = false;
    try {
      let totalContent = '';
      let totalToolCalls = 0;

      // Bridge VS Code CancellationToken to AbortSignal for the client
      const abortCtrl = new AbortController();
      token.onCancellationRequested(() => abortCtrl.abort());

      for await (const chunk of this.client.streamChatCompletion(request, abortCtrl.signal)) {
        if (token.isCancellationRequested) {
          break;
        }

        if (chunk.content) {
          if (thinking){
            // A clean trailing gap closes out any open lists/code blocks before ending the HTML block
            progress.report(new vscode.LanguageModelTextPart("\n\n</THINKING>\n\n"));
            thinking = false;
          }
          // Check if content is XML and log it separately for debugging
          if (chunk.content.trim().startsWith('<function')) {
            this.logger.error(`[DEBUG] Received raw XML chunk (not SSE format): ${chunk.content.substring(0, 500)}...`);
          }

          totalContent += chunk.content;
          progress.report(new vscode.LanguageModelTextPart(chunk.content));
        }

        if (chunk.reasoning_content) {
          if (!thinking){
            // Mandate double newlines so nested blocks have room to compile
            progress.report(new vscode.LanguageModelTextPart("\n\n<THINKING>\n\n"));
            thinking = true;
          }
          let reasoning_content = chunk.reasoning_content;
          this.logger.debug(`THINK: ${chunk.reasoning_content}`);
          // Push to the dedicated UI thinking block container
          progress.report(new vscode.LanguageModelTextPart(reasoning_content));
        }

        if (chunk.finished_tool_calls && chunk.finished_tool_calls.length > 0) {
          for (const toolCall of chunk.finished_tool_calls) {
            totalToolCalls++;
            this.logger.info(`Tool call received: id=${toolCall.id}, name=${toolCall.name}`);
            this.logger.debug(`  Raw arguments: ${toolCall.arguments.substring(0, 500)}${toolCall.arguments.length > 500 ? '...' : ''}`);

            // Parse arguments with repair capability
            let args = this.tryRepairJson(toolCall.arguments) as Record<string, unknown> | null;

            if (args === null) {
              this.logger.error(`Failed to parse tool call arguments for ${toolCall.name}`);
              this.logger.debug(`  Full arguments: ${toolCall.arguments}`);
              args = {}; // Fallback to empty args
            }

            // Report the tool call to the UI so the user sees the pending call
            progress.report(new vscode.LanguageModelToolCallPart(
              toolCall.id,
              toolCall.name,
              args as object
            ));

            // Store a progress reporter for the eventual tool result (used elsewhere if needed)
            this.pendingToolCalls.set(toolCall.id, progress);

            // Clean up pending map
            this.pendingToolCalls.delete(toolCall.id);
          }
        }
      

        if (chunk.usage) {
          progress.report(new vscode.MarkdownString(`Tokens: Input ${chunk.usage.prompt_tokens}, Output ${chunk.usage.completion_tokens}, Total ${chunk.usage.total_tokens}`));
        }
      }

      this.logger.info(`Completed chat request, received ${totalContent.length} characters, ${totalToolCalls} tool calls`);
        
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(` Chat request failed: ${errorMessage}`);
      throw error;
    }finally{
      if (thinking){
            progress.report(new vscode.LanguageModelTextPart("  \n</THINKING>\n\n"))
            thinking = false;
          }
    }
  }

  private TruncateMessages(options: vscode.ProvideLanguageModelChatResponseOptions, aiMessages: Message[]) {
    const modelMaxContext = this.config.defaultMaxTokens || 32768;
    const desiredOutputTokens = Math.min(this.config.defaultMaxOutputTokens || 2048, Math.floor(modelMaxContext / 2));
    const toolsTokenEstimate = options.tools ? Math.ceil(JSON.stringify(options.tools).length / 4 * 1.2) : 0;
    const reservedForInput = modelMaxContext - desiredOutputTokens - toolsTokenEstimate - 256;

    // we need to estimate the total input tokens based on the messages and tool calls, and truncate if necessary

    // Build input text for an initial token estimate using ALL messages
    const fullInputText = aiMessages
      .map((m) => {
        let text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
        if ((m as any).tool_calls) { text += JSON.stringify((m as any).tool_calls); }
        return text;
      })
      .join('\n');

    const initialInputTokens = Math.ceil(fullInputText.length / 4);

    //first we need to remove unnecessary text: '<userRequest>Try Again</userRequest>'
    let cleanedMessages = aiMessages.map((m) => {
      if (typeof m.content === 'string') {
        const cleanedContent = m.content.replace('<userRequest>\nTry Again\n</userRequest>\n', '').trim();
        return { ...m, content: cleanedContent };
      }
      return m;
    }).filter((m) => {
      if (typeof m.content === 'string') {
        return m.content.trim().length > 0;
      }
      return true;
      });


    // Only truncate when the combined estimate truly exceeds the available context
    let truncatedMessages = cleanedMessages;
    if (initialInputTokens > reservedForInput) {
      const maxInputTokens = reservedForInput;
      truncatedMessages = this.truncateMessagesToFit(cleanedMessages, maxInputTokens);
      if (truncatedMessages.length < cleanedMessages.length) {
        this.logger.warn(`Truncated conversation from ${cleanedMessages.length} to ${truncatedMessages.length} messages to fit context limit`);
      }
    }
    return truncatedMessages;
  }

  /**
   * Provide token count estimation
   */
  public async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string')
    {
      // For local setups without a heavy tokenizer library, a 1-to-4 character ratio 
      // is the standard fallback behavior used in community extensions
      return Math.ceil(text.length / 4);
    }
    
    // content is  Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelDataPart
    const content = text.content
      .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
      .map((part) => part.value)
      .join('');
    
    const estimatedTokens = Math.ceil(content.length / 4);
    return estimatedTokens;
  }

  // Private helper methods

  protected mapRole(role: vscode.LanguageModelChatMessageRole): string {
    if (role as Number === 3) { // vscode.LanguageModelChatMessageRole.System
      return 'system';
    }

    if (role === vscode.LanguageModelChatMessageRole.User) {
      return 'user';
    }
    if (role === vscode.LanguageModelChatMessageRole.Assistant) {
      return 'assistant';
    }
    return 'user';
  }

  protected convertToolResultPart(part: vscode.LanguageModelToolResultPart): Record<string, unknown> {
    return {
      tool_call_id: part.callId,
      role: 'tool',
      content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
    };
  }

  protected convertToolCallPart(part: vscode.LanguageModelToolCallPart): Record<string, unknown> {
    return {
      id: part.callId,
      type: 'function',
      function: {
        name: part.name,
        arguments: JSON.stringify(part.input),
      },
    };
  }

  protected processPartDuckTyped(
    part: unknown,
    toolResults: Record<string, unknown>[],
    toolCalls: Record<string, unknown>[]
  ): void {
    const anyPart = part as Record<string, unknown>;
    if ('callId' in anyPart && 'content' in anyPart && !('name' in anyPart)) {
      this.logger.debug(`  Found tool result (duck-typed): callId=${anyPart.callId}`);
      toolResults.push({
        tool_call_id: anyPart.callId,
        role: 'tool',
        content: typeof anyPart.content === 'string' ? anyPart.content : JSON.stringify(anyPart.content),
      });
    } else if ('callId' in anyPart && 'name' in anyPart && 'input' in anyPart) {
      this.logger.debug(`  Found tool call (duck-typed): callId=${anyPart.callId}, name=${anyPart.name}`);
      toolCalls.push({
        id: anyPart.callId,
        type: 'function',
        function: { name: anyPart.name, arguments: JSON.stringify(anyPart.input) },
      });
    }
  }

  protected convertSingleMessageWithLogging(msg: vscode.LanguageModelChatMessage): Record<string, unknown>[] {
    const role = this.mapRole(msg.role);
    const toolResults: Record<string, unknown>[] = [];
    const toolCalls: Record<string, unknown>[] = [];
    let textContent = '';

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textContent += part.value;
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        this.logger.debug(`  Found tool result: callId=${part.callId}`);
        toolResults.push(this.convertToolResultPart(part));
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        this.logger.debug(`  Found tool call: callId=${part.callId}, name=${part.name}`);
        toolCalls.push(this.convertToolCallPart(part));
      } else {
        this.processPartDuckTyped(part, toolResults, toolCalls);
      }
    }

    const result: Record<string, unknown>[] = [];
    if (toolCalls.length > 0) {
      result.push({ role: 'assistant', content: textContent || null, tool_calls: toolCalls });
    } else if (toolResults.length > 0) {
      result.push(...toolResults);
    } else if (textContent) {
      result.push({ role, content: textContent });
    }
    return result;
  }

  private calculateSafeMaxOutputTokens(estimatedInputTokens: number, toolsOverhead: number): number {
    const modelMaxContext = this.config.defaultMaxTokens || 32768;
    const totalEstimatedTokens = estimatedInputTokens + toolsOverhead;
    const conservativeInputEstimate = Math.ceil(totalEstimatedTokens * 1.2);
    const bufferTokens = 256;

    let safeMaxOutputTokens = Math.min(
      this.config.defaultMaxOutputTokens || 2048,
      Math.floor(modelMaxContext - conservativeInputEstimate - bufferTokens)
    );

    return Math.max(64, safeMaxOutputTokens);
  }

  private buildToolsConfig(options: vscode.ProvideLanguageModelChatResponseOptions): ToolDefinition[] | undefined {
    if (!this.config.enableToolCalling || !options.tools || options.tools.length === 0) {
      return undefined;
    }

    this.currentToolSchemas.clear();

    return options.tools.map((tool) => {
      this.logger.info(`Tool: ${tool.name}`);
      this.logger.debug(`  Description: ${tool.description?.substring(0, 100) || 'none'}...`);

      const schema = tool.inputSchema as Record<string, unknown> | undefined;
      this.currentToolSchemas.set(tool.name, schema);

      if (schema?.required && Array.isArray(schema.required)) {
        this.logger.debug(`  Required properties: ${(schema.required as string[]).join(', ')}`);
      }

      return {
        name: tool.name, 
        description: tool.description, 
        parameters: tool.inputSchema as object
      };
    });
  }


private toAiMessages(messages: readonly vscode.LanguageModelChatMessage[]): any[] {
  const aiMessages: any[] = [];

  for (const msg of messages) {
    const role = this.mapRole(msg.role);
    
    // 1. Handle Tool Result Messages (Directly mapping 'tool' roles)
    // Checking for tool results first ensures tool response flows are never bound back to standard roles
    const toolResults = msg.content.filter(part => part instanceof vscode.LanguageModelToolResultPart);
    if (toolResults.length > 0) {
      for (const part of toolResults) {
        let resultString = '';
        if (typeof part.content === 'string') {
          resultString = part.content;
        } else if (part.content && typeof part.content === 'object' && 'value' in part.content) {
          resultString = (part.content as any).value;
        } else {
          resultString = JSON.stringify(part.content ?? '');
        }

        aiMessages.push({
          role: 'tool',
          tool_call_id: part.callId,
          content: resultString
        });
      }
      continue; // Skip the rest of this loop iteration since it was processed cleanly as tool-specific roles
    }

    // 2. Coalesce Text Content and Tool Calls into a Single, Compliant Message Object
    let textContent = '';
    const toolCalls: any[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textContent += part.value;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input),
          }
        });
      }
    }

    // 3. Assemble and Push openAI-Compliant Structures
    if (toolCalls.length > 0) {
      // Vital: If tools exist, content MUST explicitly be null or string, and tied to an assistant role 
      aiMessages.push({
        role: 'assistant',
        content: textContent || "", 
        tool_calls: toolCalls
      });
    } else if (textContent) {
      aiMessages.push({
        role: role,
        content: textContent
      });
    }
  }

  return aiMessages;
}


  private toAIRequest(
    model: vscode.LanguageModelChatInformation,
    messages: Message[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
  ): AIRequest {
    

    const requestOptions: RequestOptions = {
      model: model.id,
      temperature: options.modelOptions?.temperature,
      maxTokens: options.modelOptions?.maxTokens,
      tools: this.buildToolsConfig(options),
      providerOptions: options.modelOptions?.extensionParameters,
    };

    return {
      messages: messages,
      options: requestOptions,
    };
  }


}
