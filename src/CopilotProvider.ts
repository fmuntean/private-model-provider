/**
 * CopilotProvider — VSCode-specific implementation that extends BaseProvider.
 * This class handles the VS Code's GitHub Copilot Chat API integration, implementing
 * vscode.LanguageModelChatProvider interface for the Copilot Chat extension.
 * 
 * https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider
 */

import * as vscode from 'vscode';
import { BaseProvider } from './core/BaseProvider';
import { GatewayConfig, OpenAIChatCompletionRequest, ModelInfo } from './types';
import { IllmClient } from './core/interfaces';
import { ILogger } from './core/interfaces';

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

    // Convert messages to OpenAI format
    const openAIMessages: Record<string, unknown>[] = [];
    for (const msg of messages) {
      const convertedMsgs = this.convertSingleMessageWithLogging(msg);
      for (const converted of convertedMsgs) {
        openAIMessages.push(converted);
      }
    }
    this.logger.debug(`Converted to ${openAIMessages.length} OpenAI messages`);

    // Calculate token limits
    const modelMaxContext = this.config.defaultMaxTokens || 32768;
    const desiredOutputTokens = Math.min(this.config.defaultMaxOutputTokens || 2048, Math.floor(modelMaxContext / 2));
    const toolsTokenEstimate = options.tools ? Math.ceil(JSON.stringify(options.tools).length / 4 * 1.2) : 0;
    const reservedForInput = modelMaxContext - desiredOutputTokens - toolsTokenEstimate - 256;

    // Build input text for an initial token estimate using ALL messages
    const fullInputText = openAIMessages
      .map((m) => {
        let text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
        if ((m as any).tool_calls) { text += JSON.stringify((m as any).tool_calls); }
        return text;
      })
      .join('\n');

    const initialInputTokens = Math.ceil(fullInputText.length / 4);

    // Only truncate when the combined estimate truly exceeds the available context
    let truncatedMessages = openAIMessages;
    if (initialInputTokens > reservedForInput) {
      const maxInputTokens = reservedForInput;
      truncatedMessages = this.truncateMessagesToFit(openAIMessages, maxInputTokens);
      if (truncatedMessages.length < openAIMessages.length) {
        this.logger.warn(`Truncated conversation from ${openAIMessages.length} to ${truncatedMessages.length} messages to fit context limit`);
      }
    }

    // Build input text for token estimation (final set used in request)
    const inputText = truncatedMessages
      .map((m) => {
        let text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
        if (m.tool_calls) { text += JSON.stringify(m.tool_calls); }
        return text;
      })
      .join('\n');

    const estimatedInputTokens = Math.ceil(inputText.length / 4);
    const safeMaxOutputTokens = this.calculateSafeMaxOutputTokens(estimatedInputTokens, toolsTokenEstimate);

    this.logger.debug(
      `Token estimate: input=${estimatedInputTokens}, tools=${toolsTokenEstimate}, model_context=${modelMaxContext}, chosen_max_tokens=${safeMaxOutputTokens}`
    );

    // Build request
    const hasTools = this.config.enableToolCalling && options.tools && options.tools.length > 0;
    const temperature = hasTools ? (this.config.agentTemperature ?? 0) : 0.7;

    const requestOptions: Record<string, unknown> = {
      model: model.id,
      messages: truncatedMessages,
      max_tokens: safeMaxOutputTokens,
      temperature,
    };

    // Only include sampling parameters when they differ from defaults
    if (this.config.topP !== 1.0) {
      requestOptions.top_p = this.config.topP;
    }
    if (this.config.frequencyPenalty !== 0) {
      requestOptions.frequency_penalty = this.config.frequencyPenalty;
    }
    if (this.config.presencePenalty !== 0) {
      requestOptions.presence_penalty = this.config.presencePenalty;
    }

    const toolsConfig = this.buildToolsConfig(options);
    if (toolsConfig) {
      requestOptions.tools = toolsConfig;
      if (options.toolMode !== undefined) {
        requestOptions.tool_choice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
      }
      if (this.config.parallelToolCalling) {
        requestOptions.parallel_tool_calls = true;
      }
      this.logger.info(`Sending ${toolsConfig.length} tools to model (parallel: ${this.config.parallelToolCalling})`);
    }

    if (options.modelOptions) {
      Object.assign(requestOptions, options.modelOptions);
    }

    // Log request
    const debugRequest = JSON.stringify(requestOptions, null, 2);
    this.logger.debug(debugRequest.length > 2000 ? `Request (truncated): ${debugRequest.substring(0, 2000)}...` : `Request: ${debugRequest}`);

    try {
      let totalContent = '';
      let totalToolCalls = 0;

      // Bridge VS Code CancellationToken to AbortSignal for the client
      const abortCtrl = new AbortController();
      token.onCancellationRequested(() => abortCtrl.abort());

      for await (const chunk of this.client.streamChatCompletion(requestOptions as unknown as OpenAIChatCompletionRequest, abortCtrl.signal)) {
        if (token.isCancellationRequested) {
          break;
        }

        if (chunk.content) {
          this.logger.debug(`CHUNK: ${chunk.content}`);
          totalContent += chunk.content;
          progress.report(new vscode.LanguageModelTextPart(chunk.content));
        }

        if (chunk.reasoning_content) {
          this.logger.debug(`THINK: ${chunk.reasoning_content}`);
          progress.report(new vscode.MarkdownString(chunk.reasoning_content));
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
      

        this.logger.info(`Completed chat request, received ${totalContent.length} characters, ${totalToolCalls} tool calls`);
        if (chunk.usage) {
          progress.report(new vscode.MarkdownString(`Tokens: Input ${chunk.usage.prompt_tokens}, Output ${chunk.usage.completion_tokens}, Total ${chunk.usage.total_tokens}`));
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(` Chat request failed: ${errorMessage}`);
      throw error;
    }
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

  private buildToolsConfig(options: vscode.ProvideLanguageModelChatResponseOptions): Record<string, unknown>[] | undefined {
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
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      };
    });
  }


}
