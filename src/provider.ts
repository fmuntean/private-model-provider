import * as vscode from 'vscode';
import { GatewayConfig, OpenAIChatCompletionRequest, ChatMessageType, ChatSession, MessageChunk, ModelInfo } from './types';
import { IllmClientConfig } from './core/interfaces';
import { MCPManager } from './mcp';
import { SecretManager } from './secretManager';
import { StatisticsManager } from './statistics';
import { SessionManager } from './sessionManager';
import { Logger } from './vscodeLogger';
// Added for logging chat history
import * as fs from 'fs';
import * as path from 'path';
import { runCopilotTool,runInTerminalLocal } from './tools';
import { LlmClient } from './core/llmClient';
import { IOutputChannel } from './core/interfaces';
import { getClientConfig, getGatewayConfig } from './config';

/**
 * Language model provider for OpenAI-compatible inference servers
 */
/**
 * {@link GatewayProvider} is the concrete implementation of VS Code's
 * {@link vscode.LanguageModelChatProvider} API. It is registered in
 * {@link src/extension.ts} via `vscode.lm.registerLanguageModelChatProvider`
 * under the provider id `private-model-provider`.
 *
 * The VS Code Copilot Chat extension discovers language model providers
 * through this registration. When a user opens a Copilot Chat session, the
 * extension queries the provider for available models via
 * {@link provideLanguageModelChatInformation} and then streams chat
 * completions using {@link provideLanguageModelChatResponse}.
 *
 * The provider handles configuration, secret management, model caching,
 * tool calling, and streaming of responses from the underlying inference
 * server (via {@link LlmClient}).
 * 
 * @deprecated This class has been refactored into a three-layer architecture:
 * - {@link BaseProvider} - VSCode-independent utilities
 * - {@link CopilotProvider} - VSCode Copilot Chat API integration
 * - {@link ChatProvider} - Full extension functionality (recommended)
 * 
 * Use {@link ChatProvider} from `./core/ChatProvider` instead.
 * This class is kept for backward compatibility and will be removed in a future version.
 */
export class GatewayProvider implements vscode.LanguageModelChatProvider {
  private readonly client: LlmClient;
  private readonly mcpManager: MCPManager;
  private config: GatewayConfig;
  private readonly secretManager: SecretManager;
  private readonly statsManager: StatisticsManager | null;
  private readonly sessionManager: SessionManager;
  private readonly logger: Logger;
  // Store tool schemas for the current request to fill missing required properties
  private readonly currentToolSchemas: Map<string, unknown> = new Map();
  // Track if we've shown the welcome notification this session
  private hasShownWelcomeNotification = false;
  // Model cache
  private cachedModels: vscode.LanguageModelChatInformation[] | null = null;
  private modelCacheTimestamp: number = 0;
  // Ensure async init (API key load) completes before first requests
  private readonly initializationPromise: Promise<void>;
  // Event emitter for model list changes
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  
  /**
   * Execute a request function with exponential backoff retry logic.
   * Retries are driven by the provider configuration: `maxRetries` and `retryDelayMs`.
   * The delay doubles on each attempt (baseDelayMs * 2^attempt).
   * Only retries on the specific "Model unloaded" GatewayError.
   */
  private async requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelay = this.config.retryDelayMs ?? 500; // ms
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        const isModelUnloaded = err?.message?.includes('Model unloaded');
        if (!isModelUnloaded || attempt >= maxRetries) {
          throw err;
        }
        const delay = baseDelay * Math.pow(2, attempt);
        this.logger.warn(`Request failed with Model unloaded, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(res => setTimeout(res, delay));
        attempt++;
      }
    }
  }

  /**
   * Track ongoing title‑generation promises per session. This prevents the
   * provider from issuing a second title request while a previous one is still
   * loading the model, which some inference servers treat as a cancellation of
   * the first request (see server logs). The map stores the promise so that
   * subsequent calls can await the existing work instead of starting a new
   * request.
   */
  private readonly titlePromises: Map<string, Promise<string>> = new Map();
  // Map of pending tool call IDs to the progress reporter that can receive the result
  private readonly pendingToolCalls: Map<string, vscode.Progress<vscode.LanguageModelResponsePart>> = new Map();

  constructor(
    private readonly context: vscode.ExtensionContext, 
    statsManager?: StatisticsManager,
    sessionManager?: SessionManager
  ) {
    this.logger = Logger.getInstance();
    // Use singleton SecretManager (must be initialized in extension.ts first)
    this.secretManager = SecretManager.getInstance();
    this.statsManager = statsManager ?? null;
    this.sessionManager = sessionManager ?? new SessionManager(context);
    this.config = this.loadConfig();
    
    // Create IllmClientConfig by merging GatewayConfig with server URL and API key
    const clientConfig = this.createClientConfig();
    this.client = new LlmClient(clientConfig, {
      maxRetries: this.config.maxRetries,
      baseDelayMs: this.config.retryDelayMs,
    });
    // Initialize MCP manager and start any configured servers
    this.mcpManager = new MCPManager();
    // Start servers asynchronously; errors are logged inside MCPManager
    this.mcpManager.startAll().catch(err => this.logger.error('Failed to start MCP servers', err));
    
    // Initialize API key from secure storage (store promise for awaiting later)
    this.initializationPromise = this.initializeApiKey();

    // React to secret storage changes (API key updates)
    context.subscriptions.push(
      context.secrets.onDidChange(async (e) => {
        if (e.key === 'private.model.provider.apiKey') {
          await this.refreshApiKey();
        }
      })
    );

    // Watch for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
          // General configuration changes (server URL, default model, etc.)
          if (e.affectsConfiguration('private.model.provider')) {
            this.logger.info('Configuration changed, reloading...');
            void this.applyLatestConfiguration();
          }

          // Specific handling for MCP server definitions – restart servers so
          // changes take effect without requiring a full extension reload.
          if (e.affectsConfiguration('private.model.provider.mcpServers')) {
            this.logger.info('MCP server configuration changed, restarting servers');
            // Stop any currently running MCP processes before starting the new set.
            this.mcpManager.stopAll()
              .catch(err => this.logger.error('Error stopping MCP servers', err))
              .finally(() => {
                this.mcpManager.startAll()
                  .catch(err => this.logger.error('Error starting MCP servers', err));
              });
          }
        })
    );
  }

  /**
   * Create IllmClientConfig by merging GatewayConfig with server URL and API key
   */
  private createClientConfig(): IllmClientConfig {
    const cfg = vscode.workspace.getConfiguration('private.model.provider');
    let serverUrlRaw = cfg.get<string>('serverUrl', 'http://localhost:8000');
    // Remove trailing /v1 if present
    if (/\/v1\/?$/.test(serverUrlRaw)) {
      serverUrlRaw = serverUrlRaw.replace(/\/v1\/?$/, '');
    }
    // Remove any trailing slash
    if (/\/$/.test(serverUrlRaw)) {
      serverUrlRaw = serverUrlRaw.replace(/\/+$/, '');
    }
    
    return {
      serverUrl: serverUrlRaw,
      apiKey: '', // Will be set asynchronously in initializeApiKey
      requestTimeout: cfg.get<number>('requestTimeout', 60000),
    };
  }

  /**
   * Ensure the daily log folder exists: /ai-logs/YYYY-MM-DD
   */
  private ensureLogFolder(): string {
    // Determine the workspace root, fallback to extension storage if no workspace is open
    const workspaceRoot = this.getWorkspaceRoot();
    const base = path.join(workspaceRoot, 'ai-logs');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const folder = path.join(base, today);
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch (e) {
      this.logger.error(`Failed to create log folder ${folder}:`, e);
    }
    return folder;
  }

  /**
   * Retrieve the workspace root path, mirroring the logic in SessionManager.
   */
  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    // Fallback to the extension's global storage path
    return this.context.globalStorageUri.fsPath;
  }

  /**
   * Append a JSONL line to the appropriate file for the given chatId.
   */
  private writeLogEntry(chatId: string, entry: Record<string, unknown>): void {
    const folder = this.ensureLogFolder();
    const now = new Date();
    const timestamp = now.toISOString()
    const hhmm = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0');
    const fileName = `${hhmm}-${chatId}.jsonl`;
    const filePath = path.join(folder, fileName);
    const line = JSON.stringify({ timestamp, chatId, ...entry });
    try {
      fs.appendFileSync(filePath, line + '\n');
    } catch (e) {
      this.logger.error(`Failed to write log entry to ${filePath}:`, e);
    }
  }

  /**
   * Initialize API key from secure storage asynchronously
   */
  private async initializeApiKey(): Promise<void> {
    try {
      const apiKey = await SecretManager.getClientApiKey();
      if (apiKey) {
        const clientConfig = this.createClientConfig();
        clientConfig.apiKey = apiKey;
        this.client.updateConfig(clientConfig);
        this.logger.info('API key loaded from secure storage');
      }
    } catch (error) {
      this.logger.error('Failed to load API key:', error);
    }
  }

  /**
   * Force refresh API key from secure storage and update client immediately
   */
  public async refreshApiKey(): Promise<void> {
    try {
      const apiKey = await SecretManager.getClientApiKey();
      const clientConfig = this.createClientConfig();
      clientConfig.apiKey = apiKey || '';
      this.client.updateConfig(clientConfig);
      this.logger.info(apiKey ? 'API key updated from secure storage' : 'API key cleared');
      // Clear model cache so next call revalidates with new credentials
      this.cachedModels = null;
      this.modelCacheTimestamp = 0;
    } catch (error) {
      this.logger.error('Failed to refresh API key:', error);
    }
  }

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
   * Refresh the model cache and notify listeners.
   * This method clears the cache, fetches the latest model list from the server,
   * updates the internal cache, and then fires the change event so that any UI
   * components (e.g., the built‑in model dropdown) are refreshed.
   */
  public async refreshModels(): Promise<vscode.LanguageModelChatInformation[]> {
    // Clear existing cache first
    this.clearModelCache();
    // Fetch fresh models (silent false to allow UI messages if needed)
    const models = await this.provideLanguageModelChatInformation(
      { silent: false },
      new vscode.CancellationTokenSource().token
    );
    // Update cache timestamp (provideLanguageModelChatInformation already caches)
    // Fire change event to notify UI of the new list
    this._onDidChangeLanguageModelChatInformation.fire();
    return models;
  }

  /**
   * Immediately reload configuration and update HTTP client.
   * Useful when settings are programmatically changed and we want
   * to ensure subsequent operations use the latest config without
   * waiting for VS Code config change events.
   */
  public async applyLatestConfiguration(): Promise<void> {
    // Reuse existing reload logic
    this.reloadConfig();
    // Refresh API key to ensure latest value is used
    await this.refreshApiKey();
    // Clear model cache on config change
    this.cachedModels = null;
    this.modelCacheTimestamp = 0;
  }

  /**
   * Get the SecretManager for external use (e.g., commands)
   */
  public getSecretManager(): SecretManager {
    return this.secretManager;
  }

  /**
   * Get the output channel for external use (e.g., commands)
   * @deprecated  This will be removed soon.
  */
  public getOutputChannel(): IOutputChannel {
    this.logger.show();
    return this.logger.getOutputChannel();
  }

  /**
   * Map VS Code message role to OpenAI role string
   */
  private mapRole(role: vscode.LanguageModelChatMessageRole): string {
    if (role === vscode.LanguageModelChatMessageRole.User) {
      return 'user';
    }
    if (role === vscode.LanguageModelChatMessageRole.Assistant) {
      return 'assistant';
    }
    return 'user';
  }

  /**
   * Convert a tool result part to OpenAI format
   */
  private convertToolResultPart(part: vscode.LanguageModelToolResultPart): Record<string, unknown> {
    return {
      tool_call_id: part.callId,
      role: 'tool',
      content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
    };
  }

  /**
   * Convert a tool call part to OpenAI format
   */
  private convertToolCallPart(part: vscode.LanguageModelToolCallPart): Record<string, unknown> {
    return {
      id: part.callId,
      type: 'function',
      function: {
        name: part.name,
        arguments: JSON.stringify(part.input),
      },
    };
  }

  // Helper method: convertMessages (kept for potential future use)
  private convertMessages(messages: readonly vscode.LanguageModelChatMessage[]): Record<string, unknown>[] {
    const openAIMessages: Record<string, unknown>[] = [];

    for (const msg of messages) {
      const role = this.mapRole(msg.role);
      const toolResults: Record<string, unknown>[] = [];
      const toolCalls: Record<string, unknown>[] = [];
      let textContent = '';

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          textContent += part.value;
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          toolResults.push(this.convertToolResultPart(part));
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCalls.push(this.convertToolCallPart(part));
        }
      }

      if (toolCalls.length > 0) {
        openAIMessages.push({ role: 'assistant', content: textContent || null, tool_calls: toolCalls });
      } else if (toolResults.length > 0) {
        openAIMessages.push(...toolResults);
      } else if (textContent) {
        openAIMessages.push({ role, content: textContent });
      }
    }

    return openAIMessages;
  }

  // Helper method: buildRequestOptions
  private buildRequestOptions(
    model: vscode.LanguageModelChatInformation,
    openAIMessages: any[],
    estimatedInputTokens: number
  ): any {
    const modelMaxContext = this.config.defaultMaxTokens || 32768;
    const bufferTokens = 128;
    let safeMaxOutputTokens = Math.min(
      this.config.defaultMaxOutputTokens || 2048,
      Math.floor(modelMaxContext - estimatedInputTokens - bufferTokens)
    );
    if (safeMaxOutputTokens < 64) {
      safeMaxOutputTokens = Math.max(64, Math.floor((this.config.defaultMaxOutputTokens || 2048) / 2));
    }

    this.logger.info(`Token estimate: input=${estimatedInputTokens}, model_context=${modelMaxContext}, chosen_max_tokens=${safeMaxOutputTokens}`);

    const requestOptions: any = {
      model: model.id,
      messages: openAIMessages,
      max_tokens: safeMaxOutputTokens,
      temperature: 0.7,
    };

    return requestOptions;
  }

  // Helper method: addTooling
  private addTooling(
    requestOptions: any,
    options: vscode.ProvideLanguageModelChatResponseOptions
  ): void {
    // Combine built‑in tools (from the request) with any MCP tools configured by the user.
    const toolSchemas: any[] = [];

    // First, include any tools passed in via the request options (e.g., from the chat UI).
    if (options.tools && options.tools.length > 0) {
      toolSchemas.push(
        ...options.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        }))
      );
    }

    // Next, include MCP server tool definitions if tool calling is enabled.
    if (this.config.enableToolCalling) {
      try {
        const mcpTools = this.mcpManager.getToolDefinitions();
        if (Array.isArray(mcpTools) && mcpTools.length > 0) {
          toolSchemas.push(...mcpTools);
        }
      } catch (e:any) {
        // Log but do not fail the request – MCP tools are optional.
        this.logger.warn(`Failed to retrieve MCP tool definitions: ${e.message}`);
      }
    }

    if (toolSchemas.length > 0) {
      requestOptions.tools = toolSchemas;
      if (options.toolMode !== undefined) {
        requestOptions.tool_choice =
          options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
      }
      requestOptions.parallel_tool_calls = this.config.parallelToolCalling;
      this.logger.info(
        `Sending ${requestOptions.tools.length} tools to model (parallel: ${this.config.parallelToolCalling})`
      );
    }
  }

  /**
   * Get default value for a JSON schema type
   */
  private getDefaultForType(schema: Record<string, unknown> | null | undefined): unknown {
    if (!schema?.type) {
      return null;
    }

    switch (schema.type) {
      case 'string':
        return schema.default ?? '';
      case 'number':
      case 'integer':
        return schema.default ?? 0;
      case 'boolean':
        return schema.default ?? false;
      case 'array':
        return schema.default ?? [];
      case 'object':
        return schema.default ?? {};
      case 'null':
        return null;
      default:
        // Handle union types like ["string", "null"]
        if (Array.isArray(schema.type)) {
          if (schema.type.includes('null')) {
            return null;
          }
          // Use first non-null type
          for (const t of schema.type) {
            if (t !== 'null') {
              return this.getDefaultForType({ ...schema, type: t });
            }
          }
        }
        return null;
    }
  }

  /**
   * Fill in missing required properties with default values based on the tool schema
   */
  private fillMissingRequiredProperties(args: Record<string, unknown>, toolName: string, toolSchema: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!toolSchema?.required || !Array.isArray(toolSchema.required)) {
      return args;
    }

    const properties = (toolSchema.properties || {}) as Record<string, Record<string, unknown>>;
    const filledArgs = { ...args };
    const filledProperties: string[] = [];

    for (const requiredProp of toolSchema.required as string[]) {
      if (!(requiredProp in filledArgs)) {
        const propSchema = properties[requiredProp];
        const defaultValue = this.getDefaultForType(propSchema);
        filledArgs[requiredProp] = defaultValue;
        filledProperties.push(`${requiredProp}=${JSON.stringify(defaultValue)}`);
      }
    }

    if (filledProperties.length > 0) {
      this.logger.info(`  AUTO-FILLED missing required properties: ${filledProperties.join(', ')}`);
    }

    return filledArgs;
  }

  /**
   * Estimate token count for a message
   */
  private estimateMessageTokens(message: any): number {
    let text = '';
    if (typeof message.content === 'string') {
      text = message.content;
    } else if (message.content) {
      text = JSON.stringify(message.content);
    }
    if (message.tool_calls) {
      text += JSON.stringify(message.tool_calls);
    }
    // Rough estimate: ~4 or 5 characters per token
    return Math.ceil(text.length / 5);
  }

  /**
   * Truncate messages to fit within a token limit.
   * Strategy: Keep the first message (usually system prompt) and the most recent messages.
   * Remove older messages from the middle of the conversation.
   */
  private truncateMessagesToFit(messages: any[], maxTokens: number): any[] {
    if (messages.length === 0) {
      return messages;
    }

    // Calculate total tokens
    let totalTokens = 0;
    const messageTokens: number[] = [];
    for (const msg of messages) {
      const tokens = this.estimateMessageTokens(msg);
      messageTokens.push(tokens);
      totalTokens += tokens;
    }

    // If we're within limits, return as-is
    if (totalTokens <= maxTokens) {
      return messages;
    }

    this.logger.info(`Context overflow: ${totalTokens} tokens > ${maxTokens} limit. Truncating...`);

    // Strategy: Keep first message (system) and as many recent messages as possible
    const result: any[] = [];
    let usedTokens = 0;

    // Always keep the first message if it exists (usually system prompt)
    if (messages.length > 0) {
      result.push(messages[0]);
      usedTokens += messageTokens[0];
    }

    // Work backwards from the end, adding messages until we hit the limit
    const recentMessages: any[] = [];
    for (let i = messages.length - 1; i > 0; i--) {
      const msgTokens = messageTokens[i];
      if (usedTokens + msgTokens <= maxTokens) {
        recentMessages.unshift(messages[i]);
        usedTokens += msgTokens;
      } else {
        // Stop when we can't fit more messages
        break;
      }
    }

    // Combine first message with recent messages
    result.push(...recentMessages);

    this.logger.info(`Truncated: kept ${result.length}/${messages.length} messages, ~${usedTokens} tokens`);

    return result;
  }

  /**
   * Count occurrences of a character in a string
   */
  private countChar(str: string, char: string): number {
    // Escape regex special characters in the search char
    const escapePattern = /[.*+?^${}()|[\]\\]/g;
    const escapedChar = char.replaceAll(escapePattern, String.raw`\$&`);
    const regex = new RegExp(escapedChar, 'g');
    let count = 0;
    while (regex.exec(str) !== null) {
      count++;
    }
    return count;
  }

  /**
   * Balance unclosed braces/brackets in a JSON string
   */
  private balanceBrackets(str: string): string {
    let result = str;
    const missingBrackets = this.countChar(result, '[') - this.countChar(result, ']');
    const missingBraces = this.countChar(result, '{') - this.countChar(result, '}');

    result += ']'.repeat(Math.max(0, missingBrackets));
    result += '}'.repeat(Math.max(0, missingBraces));

    return result;
  }

  /**
   * Attempt to repair truncated or malformed JSON arguments
   */
  private tryRepairJson(jsonStr: string): unknown {
    if (!jsonStr || jsonStr.trim() === '') {
      return {};
    }

    // First, try direct parse
    try {
      return JSON.parse(jsonStr);
    } catch {
      // Continue to repair attempts
    }

    // Attempt repairs for common issues
    let repaired = jsonStr.trim();

    // Fix missing closing brackets/braces
    repaired = this.balanceBrackets(repaired);

    // Fix trailing comma before closing brace/bracket
    repaired = repaired.replaceAll(/,\s*([}\]])/g, '$1');

    // Fix truncated string value - close the string if odd number of quotes
    if (this.countChar(repaired, '"') % 2 !== 0) {
      repaired += '"';
      repaired = this.balanceBrackets(repaired);
    }

    try {
      return JSON.parse(repaired);
    } catch {
      this.logger.error(`JSON repair failed. Original: ${jsonStr}`);
      this.logger.error(`Repaired attempt: ${repaired}`);
      return null;
    }
  }

  // Helper method: streamChatCompletion (updated for new client interface)
  private async streamChatCompletion(
    requestOptions: any,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    this.logger.info(`Streaming chat completion...`);
    let totalContent = '';
    let totalToolCalls = 0;
    let streamAborted = false; // Flag to abort streaming on tool error

    // Variable to hold final usage object from client stream
    let usage: any = undefined;
    // Create an AbortController to bridge VS Code CancellationToken to AbortSignal
    const abortCtrl = new AbortController();
    // When the VS Code token signals cancellation, abort the controller
    token.onCancellationRequested(() => abortCtrl.abort());
    for await (const chunk of this.client.streamChatCompletion(requestOptions, abortCtrl.signal)) {
      if (token.isCancellationRequested) {
        break;
      }

      // Report text content immediately
      if (chunk.content) {
        this.logger.debug("CHUNK: "+chunk.content);
        totalContent += chunk.content;
        progress.report(new vscode.LanguageModelTextPart(chunk.content));
      }

      if (chunk.reasoning_content){
        this.logger.debug("THINK: "+chunk.reasoning_content);
        progress.report(new vscode.MarkdownString(chunk.reasoning_content));
      }

      // Process finished tool calls (fully accumulated by client)
        // Capture usage if present in this chunk
        if (chunk.usage) {
          usage = chunk.usage;
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

          // Execute the tool and report the result back to the model
          (async () => {
            try {
              const result = await this.executeTool(toolCall.name, args as Record<string, unknown>);
              // Convert result to a plain object for the tool result part
              const resultObj = typeof result === 'object' && result !== null ? result : { value: result };
              // LanguageModelToolResultPart expects either a string or an array. Cast to any to satisfy overload.
              progress.report(new vscode.LanguageModelToolResultPart(
                toolCall.id,
                JSON.stringify(resultObj) as any
              ));
            } catch (e) {
              this.logger.error(`Tool execution failed for ${toolCall.name}: ${e instanceof Error ? e.message : String(e)}`);
              // Report an error result so the model can continue
              progress.report(new vscode.LanguageModelToolResultPart(
                toolCall.id,
                JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) as any
              ));
            } finally {
              // Clean up pending map
              this.pendingToolCalls.delete(toolCall.id);
            }
          })();
        }
      }
    }

    this.logger.info(`Completed chat request, received ${totalContent.length} characters, ${totalToolCalls} tool calls`);

    // --- START OF NEW USAGE-AWARE STATS CALCULATION ---
    // The client layer now returns the final usage object upon successful stream completion.
    // We must pass this to the provider's stats manager for accurate accounting.
    if ( usage && this.statsManager) {
      this.logger.info(`[STATS] Usage data received: Total=${usage.total_tokens}, Prompt=${usage.prompt_tokens}, Completion=${usage.completion_tokens}`);
      // Assuming a method exists or needs to be called here to finalize stats with usage object
      await this.statsManager.recordChatUsage(usage); 
    } else {
      this.logger.warn(`[STATS] Warning: Could not retrieve final usage data for statistics recording.`);
    }
    // --- END OF NEW USAGE-AWARE STATS CALCULATION ---
  }

  /**
   * Execute a tool by name with the given arguments using the Copilot tool runner.
   * Returns the raw result from the tool (usually a JSON‑serialisable object).
   */
  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // The `runCopilotTool` helper knows how to map the tool name to the VS Code command.
    // It will throw if the tool is not available – we let the caller handle errors.
    this.logger.info(`Executing tool "${name}" with args ${JSON.stringify(args)}`);
    // Directly invoke the appropriate tool based on its name.
    switch (name) {
      case 'readFile':
        // Expected args: filePath, startLine?, endLine?
        return await runCopilotTool('readFile', args);
      case 'semanticSearch':
        return await runCopilotTool('semanticSearch', args);
      case 'askQuestions':
        return await runCopilotTool('askQuestions', args);
      case 'applyPatch':
        return await runCopilotTool('applyPatch', args);
      case 'runInTerminal':
        // Try Copilot sync first
        try {
          return await runCopilotTool('runInTerminal', { ...args, mode: 'sync' });
        } catch (e) {
          this.logger.warn(`Copilot runInTerminal sync failed: ${e}. Using local fallback.`);
          const { command, cwd, timeout } = args as any;
          try {
            // Import the local helper to execute the command and capture output
            //const { runInTerminalLocal } = await import('./tools');
            const result = await runInTerminalLocal(command, { cwd, timeout });
            return result;
          } catch (localErr) {
            this.logger.error(`Local runInTerminal also failed: ${localErr}`);
            // Final fallback: plain VS Code terminal (no captured output)
            const terminal = vscode.window.createTerminal({ name: `Tool: ${command}` });
            terminal.sendText(command);
            await new Promise(res => setTimeout(res, 500));
            return { status: 'sent', command };
          }
        }
      default:
        this.logger.warn(`Tool "${name}" is not recognized – falling back to generic execution`);
        return await runCopilotTool(name, args);
    }
  }

  /**
   * Provide language model information - fetches available models from inference server
   */
  /**
   * VS Code calls this method to discover the language model(s) offered by the
   * provider. It must return a list of {@link vscode.LanguageModelChatInformation}
   * objects describing each model (id, name, token limits, capabilities, etc.).
   *
   * The implementation ensures that any asynchronous initialization (e.g. loading
   * the API key) has completed, then attempts to fetch the model list from the
   * underlying inference server via {@link LlmClient.fetchModels}. Results are
   * cached for {@link GatewayConfig.modelCacheTtlMs} milliseconds to avoid
   * unnecessary network requests.
   *
   * @param options - Configuration for the request. The `silent` flag indicates
   *   whether UI error messages should be suppressed if the fetch fails.
   * @param token - VS Code cancellation token. The method respects cancellation
   *   by aborting any ongoing network request when the token is signaled.
   * @returns A promise that resolves to an array of model information objects.
   */
  async provideLanguageModelChatInformation(
    options: { silent: boolean; },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // Ensure API key (and other async init) has completed
    try {
      await this.initializationPromise;
    } catch {
      // Ignore init errors here; downstream will surface issues
    }
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
      // Update cache
      this.cachedModels = models;
      this.modelCacheTimestamp = now;
      this.logger.info(`Found ${models.length} LM Studio models: ${models.map(m => m.id).join(', ')}`);
      return models;
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
   * Process a message part using duck-typing for older VS Code versions
   */
  private processPartDuckTyped(
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

  /**
   * Extract text content from a VS Code chat message
   */
  private extractTextFromMessage(msg: vscode.LanguageModelChatMessage): string {
    let textContent = '';
    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textContent += part.value;
      }
    }
    return textContent;
  }

  /**
   * Convert a single VS Code message to OpenAI format with logging
   */
  private convertSingleMessageWithLogging(msg: vscode.LanguageModelChatMessage): Record<string, unknown>[] {
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

  /**
   * Calculate safe max output tokens based on input estimate
   */
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

  /**
   * Build tools configuration for request
   */
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

  /**
   * Process a single tool call from the stream
   */
  private processToolCall(
    toolCall: { id: string; name: string; arguments: string },
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Record<string, unknown> {
    this.logger.info(`\n=== TOOL CALL RECEIVED ===`);
    this.logger.info(`  ID: ${toolCall.id}`);
    this.logger.info(`  Name: ${toolCall.name}`);
    this.logger.debug(`  Raw arguments: ${toolCall.arguments.substring(0, 1000)}${toolCall.arguments.length > 1000 ? '...' : ''}`);
    // Parse arguments with repair capability
    let args = this.tryRepairJson(toolCall.arguments) as Record<string, unknown> | null;

    if (args === null) {
      this.logger.error(`  ERROR: Failed to parse tool call arguments`);
      // Fallback to empty args to keep processing flow stable
      args = {} as Record<string, unknown>;
    }

    const toolSchema = this.currentToolSchemas.get(toolCall.name) as Record<string, unknown> | undefined;
    if (toolSchema) {
      // args is guaranteed to be an object at this point
      args = this.fillMissingRequiredProperties(args as Record<string, unknown>, toolCall.name, toolSchema);
    }

    this.logger.info(`=== END TOOL CALL ===\n`);
    // Ensure args is an object for the LanguageModelToolCallPart constructor
    progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, args as object));

    // Return the parsed/final arguments so callers can persist the tool call if needed
    return args as Record<string, unknown>;
  }

  /**
   * Handle empty response from model
   */
  private async handleEmptyResponse(
    model: vscode.LanguageModelChatInformation,
    inputText: string,
    messageCount: number,
    toolCount: number,
    token: vscode.CancellationToken,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>
  ): Promise<void> {
    const inputTokenCount = await this.provideTokenCount(model, inputText, token);
    const modelMaxContext = this.config.defaultMaxTokens || 32768;

    this.logger.warn(` Model returned empty response with no tool calls.`);
    this.logger.info(`  Input tokens estimated: ${inputTokenCount}`);
    this.logger.info(`  Messages in conversation: ${messageCount}`);
    this.logger.info(`  Tools provided: ${toolCount}`);

    const errorHint = toolCount > 0
      ? `The model returned an empty response. This typically indicates the model failed to generate valid output with tool calling enabled. Check the inference server logs for errors.`
      : `The model returned an empty response. Check the inference server logs for details.`;

    this.logger.info(`  Issue: ${errorHint}`);

    const errorMessage = `I was unable to generate a response. ${errorHint}\n\n` +
      `Diagnostic info:\n- Model: ${model.id}\n- Tools provided: ${toolCount}\n` +
      `- Estimated input tokens: ${inputTokenCount}\n- Context limit: ${modelMaxContext}\n\n` +
      `Check the "Private Model Provider" output panel for detailed logs.`;

    progress.report(new vscode.LanguageModelTextPart(errorMessage));
  }

  /**
   * Handle chat request error
   */
  private handleChatError(error: unknown): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';

    this.logger.error(` Chat request failed: ${errorMessage}`);
    if (errorStack) {
      this.logger.error(`Stack trace: ${errorStack}`);
    }

    const isToolError = errorMessage.includes('HarmonyError') || errorMessage.includes('unexpected tokens');

    if (isToolError) {
      this.logger.info('HINT: This appears to be a tool calling format error.');
      this.logger.info('The model may not support function calling properly.');
      this.logger.info('Try: 1) Using a different model, 2) Disabling tool calling in settings, or 3) Checking inference server logs');

      vscode.window.showErrorMessage(
        `Private Model Provider: Model failed to generate valid tool calls. This model may not support function calling. Check Output panel for details.`,
        'Open Output', 'Disable Tool Calling'
      ).then((selection: string | undefined) => {
        if (selection === 'Open Output') {
          this.logger.show();
        } else if (selection === 'Disable Tool Calling') {
          vscode.workspace.getConfiguration('private.model.provider').update('enableToolCalling', false, vscode.ConfigurationTarget.Global);
        }
      });
    } else {
      vscode.window.showErrorMessage(`Private Model Provider: Chat request failed. ${errorMessage}`);
    }

    throw error;
  }

  /**
   * Provide language model chat response - streams responses from inference server
   */
  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Ensure API key (and other async init) has completed before first request
    try {
      await this.initializationPromise;
    } catch {
      // Continue; errors will be handled by request path
    }
    //this.logger.debug(`API key configured: ${this.config.apiKey ? 'yes' : 'no'}`);

    // Get or create active session
    let session = this.sessionManager.getActiveSession();
    this.logger.info(`provideLanguageModelChatResponse: Active session: ${session?.id || 'none'}`);
    if (!session) {
      session = this.sessionManager.createSession(model.id);
      this.logger.info(`Created new chat session in provideLanguageModelChatResponse: ${session.id}`);
    } else {
      this.logger.info(`Using existing session: ${session.id} with ${session.messages.length} messages`);
    }

    // Generate a unique chat identifier for this request (for logging)
    const chatId = session.id;
    
    // Log the incoming request
    this.writeLogEntry(chatId, {
      type: 'request',
      model: model.id,
      messages,
      options,
    });
    this.logger.info(`Sending chat request to model: ${model.id} (Session: ${session.id})`);
    this.logger.debug(`Tool mode: ${options.toolMode}, Tools: ${options.tools?.length || 0}`);
    this.logger.debug(`Message count: ${messages.length}`);

    this.showWelcomeNotification(model.id);

    // Convert messages and track them in the session
    const openAIMessages: Record<string, unknown>[] = [];

    // Convert VS Code messages to OpenAI format and add to session
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const convertedMsgs = this.convertSingleMessageWithLogging(msg);
      
      // Determine message type based on role and content
      let messageType: ChatMessageType = 'user';
      if (msg.role === vscode.LanguageModelChatMessageRole.User) {
        messageType = 'user';
        // Add user message to session
        const textContent = this.extractTextFromMessage(msg);
        if (textContent) {
          this.sessionManager.addMessage('user', 'user', textContent);
        }
      } else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
        messageType = 'agent';
      }

      for (const converted of convertedMsgs) {
        openAIMessages.push({ ...converted, messageType });
      }
    }
    this.logger.debug(`Converted to ${openAIMessages.length} OpenAI messages`);

    // ---------------------------------------------------------------------
    // Context Providers Integration (US-029 / FR-025)
    // ---------------------------------------------------------------------
    // Gather additional context from the newly added providers module. The
    // combined context is injected as a system‑role message at the beginning
    // of the request so that the model can use it when generating a response.
    // This is a simple default implementation – callers can later extend the
    // provider list or make it configurable via settings.
    try {
      // Lazy import to avoid circular dependencies if this file is loaded early.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { FileContextProvider, CodeContextProvider, DiffContextProvider, combineContext } =
        require('./contextProviders') as typeof import('./contextProviders');
      const providers = [
        new FileContextProvider('README.md'), // example static file
        new CodeContextProvider(),
        new DiffContextProvider(),
      ];
      const extraContext = await combineContext(providers);
      if (extraContext) {
        openAIMessages.unshift({ role: 'system', content: extraContext });
        this.logger.info('Added combined context from providers as system message');
      }
    } catch (e) {
      this.logger.warn(`Failed to gather context from providers: ${(e as Error).message}`);
    }

    // Log message structure
    for (let i = 0; i < openAIMessages.length; i++) {
      const msg = openAIMessages[i];
      const toolCallId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : 'none';
      this.logger.debug(`  Message ${i + 1}: role=${msg.role}, hasContent=${!!msg.content}, hasToolCalls=${!!msg.tool_calls}, toolCallId=${toolCallId}`);
    }

    // Calculate token limits; avoid premature truncation by checking a real estimate first
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

    const initialInputTokens = await this.provideTokenCount(model, fullInputText, token);

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

    const toolsOverhead = options.tools ? Math.ceil(JSON.stringify(options.tools).length / 4) : 0;
    const estimatedInputTokens = await this.provideTokenCount(model, inputText, token);
    const safeMaxOutputTokens = this.calculateSafeMaxOutputTokens(estimatedInputTokens, toolsOverhead);

    this.logger.debug(
      `Token estimate: input=${estimatedInputTokens}, tools=${toolsOverhead}, model_context=${modelMaxContext}, chosen_max_tokens=${safeMaxOutputTokens}`
    );

    // Build request — only include optional sampling parameters when non-default
    // to maximize compatibility with servers like LM Studio, Ollama, llama.cpp
    const hasTools = this.config.enableToolCalling && options.tools && options.tools.length > 0;
    const temperature = hasTools ? (this.config.agentTemperature ?? 0) : 0.7;

    const requestOptions: Record<string, unknown> = {
      model: model.id,
      messages: truncatedMessages,
      max_tokens: safeMaxOutputTokens,
      temperature,
    };

    // Only include sampling parameters when they differ from defaults
    // This avoids sending unsupported fields to servers that reject unknown params
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
      // Only send parallel_tool_calls when explicitly enabled — some servers
      // (e.g. LM Studio) reject requests containing unknown fields
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

    // Track timing for statistics
    const requestStartTime = Date.now();

    try {
      // Variable to hold final usage object from client stream
      let usage: any = undefined;
      let totalContent = '';
      let totalReasoningContent = '';
      let totalToolCalls = 0;

      // Bridge VS Code CancellationToken to AbortSignal for the client
      const abortCtrl1 = new AbortController();
      token.onCancellationRequested(() => abortCtrl1.abort());
      for await (const chunk of this.client.streamChatCompletion(requestOptions as unknown as OpenAIChatCompletionRequest, abortCtrl1.signal)) {
        if (token.isCancellationRequested) { break; }

        // Handle reasoning/thinking content from the model
        if (chunk.reasoning_content) {
          totalReasoningContent += chunk.reasoning_content;
          // Use LanguageModelThinkingPart if available (proposed API), otherwise fallback to text
          if (typeof (vscode as any).LanguageModelThinkingPart !== 'undefined') {
            progress.report(new (vscode as any).LanguageModelThinkingPart(chunk.reasoning_content));
          } else {
            // Fallback: wrap reasoning in ground tags for visibility
            progress.report(new vscode.MarkdownString(chunk.reasoning_content));
          }
        }

        if (chunk.content) {
          totalContent += chunk.content;
          progress.report(new vscode.LanguageModelTextPart(chunk.content));
        }

        // Capture usage if present in this chunk
        if ((chunk as any).usage) {
          usage = (chunk as any).usage;
        }
        if (chunk.finished_tool_calls?.length) {
          for (const toolCall of chunk.finished_tool_calls) {
            totalToolCalls++;
            this.processToolCall(toolCall, progress);
          }
        }
      }

      this.logger.info(`Completed chat request, received ${totalContent.length} characters, ${totalReasoningContent.length} reasoning characters, ${totalToolCalls} tool calls`);

      // --- START OF NEW USAGE-AWARE STATS CALCULATION ---
      // The client layer now returns the final usage object upon successful stream completion.
      // We must pass this to the provider's stats manager for accurate accounting.
      if (usage && this.statsManager) {
        this.logger.info(`[STATS] Usage data received: Total=${usage.total_tokens}, Prompt=${usage.prompt_tokens}, Completion=${usage.completion_tokens}`);
        // Record usage with stats manager
        await this.statsManager.recordChatUsage(usage, model.id);
        
        // Update session token usage by type (hybrid approach)
        if (usage.prompt_tokens && usage.completion_tokens) {
          // Estimate breakdown: assume prompt tokens are from user/context/prompt messages
          // and completion tokens are from agent responses
          const promptTokens = usage.prompt_tokens;
          const completionTokens = usage.completion_tokens;
          
          // Add agent response tokens
          this.sessionManager.updateTokenUsage('agent', 0, completionTokens);
          
          // Estimate input tokens distribution (simplified approach)
          // In practice, you might want more sophisticated tracking
          this.sessionManager.updateTokenUsage('user', Math.floor(promptTokens * 0.6), 0);
          this.sessionManager.updateTokenUsage('prompt', Math.floor(promptTokens * 0.2), 0);
          this.sessionManager.updateTokenUsage('context', Math.floor(promptTokens * 0.2), 0);
        }
      } else {
        this.logger.warn(`[STATS] Warning: Could not retrieve final usage data for statistics recording.`);
      }
      // --- END OF NEW USAGE-AWARE STATS CALCULATION ---
      
      // Add agent response to session
      if (totalContent) {
        this.sessionManager.addMessage('agent', 'assistant', totalContent, { modelId: model.id });
      }

      // Log the full response
      this.writeLogEntry(chatId, {
        type: 'response',
        model: model.id,
        content: totalContent,
        reasoning: totalReasoningContent,
        toolCalls: totalToolCalls,
        usage,
      });
    } catch (error) {
      this.handleChatError(error);
    }
  }

  /**
   * Provide token count estimation
   */
  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    // Simple approximation: ~4 characters per token
    // This is a rough estimate; for more accuracy, could use tiktoken library
    let content: string;

    if (typeof text === 'string') {
      content = text;
    } else {
      // Filter and extract only text parts from the message content
      content = text.content
        .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
        .map((part) => part.value)
        .join('');
    }

    const estimatedTokens = Math.ceil(content.length / 4);
    return estimatedTokens;
  }

  /**
   * Show a timed notification with a link to settings (once per session)
   */
  private showWelcomeNotification(modelId: string): void {
    if (this.hasShownWelcomeNotification) {
      return;
    }
    this.hasShownWelcomeNotification = true;

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Private Model Provider: ${modelId}  —  [Settings](command:workbench.action.openSettings?%22private.model.provider%22)`,
        cancellable: false,
      },
      () => new Promise((resolve) => setTimeout(resolve, 3000))
    );
  }

  /**
   * Load configuration from VS Code settings
   */
  private loadConfig(): GatewayConfig {
    const config = vscode.workspace.getConfiguration('private.model.provider');
    

    const cfg: GatewayConfig = {
      defaultMaxTokens: config.get<number>('defaultMaxTokens', 32768),
      defaultMaxOutputTokens: config.get<number>('defaultMaxOutputTokens', 4096),
      enableToolCalling: config.get<boolean>('enableToolCalling', true),
      parallelToolCalling: config.get<boolean>('parallelToolCalling', true),
      agentTemperature: config.get<number>('agentTemperature', 0),
      // Extended options
      topP: config.get<number>('topP', 1.0),
      frequencyPenalty: config.get<number>('frequencyPenalty', 0.0),
      presencePenalty: config.get<number>('presencePenalty', 0.0),
      maxRetries: config.get<number>('maxRetries', 3),
      retryDelayMs: config.get<number>('retryDelayMs', 1000),
      modelCacheTtlMs: config.get<number>('modelCacheTtlMs', 300000),
      logLevel: config.get<'debug' | 'info' | 'warn' | 'error'>('logLevel', 'info'),
    };
    
    // Validate defaultMaxOutputTokens relative to defaultMaxTokens
    if (cfg.defaultMaxOutputTokens >= cfg.defaultMaxTokens) {
      const adjusted = Math.max(64, cfg.defaultMaxTokens - 256);
      this.logger.warn(
        `WARNING: github.copilot.llm-gateway.defaultMaxOutputTokens (${cfg.defaultMaxOutputTokens}) >= defaultMaxTokens (${cfg.defaultMaxTokens}). Adjusting to ${adjusted}.`
      );
      vscode.window.showWarningMessage(
        `GitHub Copilot LLM Gateway: 'defaultMaxOutputTokens' was >= 'defaultMaxTokens'. Adjusted to ${adjusted} to avoid request errors.`
      );
      cfg.defaultMaxOutputTokens = adjusted;
    }

    return cfg;
  }

  /**
   * Reload configuration and update client
   */
  private reloadConfig(): void {
    this.config = this.loadConfig();
    const clientConfig = this.createClientConfig();
    this.client.updateConfig(clientConfig);
    this.logger.info('Configuration reloaded');
  }

  /**
   * Send a simple message from the chat webview and return the response.
   * This is a simplified interface for the webview that doesn't use streaming.
   */
  public async sendMessage(text: string, modelId?: string, sessionId?: string): Promise<{ content: string; usage?: any }> {
    await this.initializationPromise;
    this.logger.info(`sendMessage called with text: ${text.substring(0, 50)}..., modelId: ${modelId}, sessionId: ${sessionId}`);

    // Use provided model or fall back to default
    const targetModelId = modelId ||
      vscode.workspace.getConfiguration('private.model.provider').get<string>('defaultModel', '');

    if (!targetModelId) {
      throw new Error('No model selected. Please select a model from the dropdown.');
    }

    // Get or create session
    let session: ChatSession | null = null;
    let isNewSession = false;
    if (sessionId) {
      session = this.sessionManager['sessions'].get(sessionId) || null;
      this.logger.info(`Looking for session with ID: ${sessionId}, found: ${!!session}`);
    } else {
      session = this.sessionManager.getActiveSession();
      this.logger.info(`No sessionId provided, active session: ${session?.id || 'none'}`);
    }
    
    if (!session) {
      this.logger.info(`No session found, creating new session with model: ${targetModelId}`);
      session = this.sessionManager.createSession(targetModelId);
      isNewSession = true;
      this.logger.info(`Created new chat session: ${session.id}`);
    } else {
      this.logger.info(`Using existing session: ${session.id}`);
    }

    // Add user message to session
    this.sessionManager.addMessage('user', 'user', text);

    // Generate session title if this is a new session (after first user message)
    // NOTE: Previously this was fire‑and‑forget, which could cause two concurrent
    // model calls (title generation + normal chat) that race on the inference
    // server and lead to the "Failed to load model" error. We now await the
    // title generation before proceeding with the main request to ensure the
    // server handles one model load at a time.
    if (isNewSession) {
      try {
        await this.generateSessionTitle(text, session.id);
      } catch (err) {
        this.logger.error(`Failed to generate session title: ${err}`);
      }
    }

    // Build the request with conversation history
    const openAIMessages: Record<string, unknown>[] = [];
    
    // Add conversation history from session
    for (const msg of session.messages) {
      if (msg.role === 'system' && msg.type === 'prompt') {
        // Skip if we already added the master prompt
        if (openAIMessages.length === 0 || openAIMessages[0].role !== 'system') {
          openAIMessages.push({ role: 'system', content: msg.content, messageType: 'prompt' });
        }
      } else {
        openAIMessages.push({ 
          role: msg.role, 
          content: msg.content,
          messageType: msg.type
        });
      }
    }

    const requestOptions: any = {
      model: targetModelId,
      messages: openAIMessages,
      max_tokens: this.config.defaultMaxOutputTokens || 2048,
      temperature: 0.7,
      stream: false, // We want a complete response, not streaming
    };

    // Add optional parameters if they differ from defaults
    if (this.config.topP !== 1.0) {
      requestOptions.top_p = this.config.topP;
    }
    if (this.config.frequencyPenalty !== 0) {
      requestOptions.frequency_penalty = this.config.frequencyPenalty;
    }
    if (this.config.presencePenalty !== 0) {
      requestOptions.presence_penalty = this.config.presencePenalty;
    }

    // Attach tool definitions if tool calling is enabled
    if (this.config.enableToolCalling) {
      // Import the definitions lazily to avoid circular deps at top of file
      const { getToolDefinitions } = require('./tools');
      requestOptions.tools = getToolDefinitions();
    }

    try {
      this.logger.info(`Sending message to model: ${targetModelId} (Session: ${session.id})`);
      // Send the request directly to the inference server using the existing client.
      const response = await this.requestWithRetry(() => this.client.completeChat(requestOptions));
      const content = response.choices?.[0]?.message?.content || '';
      const usage = response.usage;

      // Add agent response to session
      if (content) {
        this.sessionManager.addMessage('agent', 'assistant', content);
      }

      // Record usage statistics with token tracking by type
      if (usage && this.statsManager) {
        await this.statsManager.recordChatUsage(usage, targetModelId);
        
        // Update session token usage by type
        if (usage.prompt_tokens && usage.completion_tokens) {
          const promptTokens = usage.prompt_tokens;
          const completionTokens = usage.completion_tokens;
          
          // Add agent response tokens
          this.sessionManager.updateTokenUsage('agent', 0, completionTokens);
          
          // Estimate input tokens distribution
          this.sessionManager.updateTokenUsage('user', Math.floor(promptTokens * 0.6), 0);
          this.sessionManager.updateTokenUsage('prompt', Math.floor(promptTokens * 0.2), 0);
          this.sessionManager.updateTokenUsage('context', Math.floor(promptTokens * 0.2), 0);
        }
      }

      return { content, usage };
    } catch (error) {
      this.logger.error(`Failed to send message: ${error}`);
      throw error;
    }
  }

  /**
   * Stream a chat message and call the callback with each chunk.
   * Used by the webview for streaming responses.
   */
  public async streamMessage(
    text: string,
    modelId: string | undefined,
    onChunk: (chunk: MessageChunk) => void,
    cancellationToken?: vscode.CancellationToken,
    sessionId?: string
  ): Promise<void> {
    await this.initializationPromise;

    // Use provided model or fall back to default
    const targetModelId = modelId ||
      vscode.workspace.getConfiguration('private.model.provider').get<string>('defaultModel', '');

    if (!targetModelId) {
      throw new Error('No model selected. Please select a model from the dropdown.');
    }

    // Get or create session
    let session: ChatSession | null = null;
    let isNewSession = false;
    if (sessionId) {
      session = this.sessionManager['sessions'].get(sessionId) || null;
    } else {
      session = this.sessionManager.getActiveSession();
    }
    
    if (!session) {
      session = this.sessionManager.createSession(targetModelId);
      isNewSession = true;
      this.logger.info(`Created new chat session: ${session.id}`);
    }

    // Add user message to session
    this.sessionManager.addMessage('user', 'user', text);

    // Generate session title if this is a new session (after first user message)
    if (isNewSession) {
      // Fire and forget - don't await to avoid blocking the response
      this.generateSessionTitle(text, session.id).catch(err => {
        this.logger.error(`Failed to generate session title: ${err}`);
      });
    }

    // Build the request with conversation history
    const openAIMessages: Record<string, unknown>[] = [];
    

    // Add conversation history from session
    for (const msg of session.messages) {
      if (msg.role === 'system' && msg.type === 'prompt') {
        // Skip if we already added the master prompt
        if (openAIMessages.length === 0 || openAIMessages[0].role !== 'system') {
          openAIMessages.push({ role: 'system', content: msg.content, messageType: 'prompt' });
        }
      } else {
        openAIMessages.push({ 
          role: msg.role, 
          content: msg.content,
          messageType: msg.type
        });
      }
    }

    const requestOptions: any = {
      model: targetModelId,
      messages: openAIMessages,
      max_tokens: this.config.defaultMaxOutputTokens || 2048,
      temperature: this.config.agentTemperature || 0.1,
      stream: true,
      stream_options: { include_usage: true }
    };

    // Add optional parameters if they differ from defaults
    if (this.config.topP !== 1.0) {
      requestOptions.top_p = this.config.topP;
    }
    if (this.config.frequencyPenalty !== 0) {
      requestOptions.frequency_penalty = this.config.frequencyPenalty;
    }
    if (this.config.presencePenalty !== 0) {
      requestOptions.presence_penalty = this.config.presencePenalty;
    }

    // Add tooling if tool calling is enabled
    if (this.config.enableToolCalling) {
      // Lazy import to avoid circular dependencies
      const { getToolDefinitions } = require('./tools');
      requestOptions.tools = getToolDefinitions();
    }
    
    try {
      this.logger.info(`Streaming message to model: ${targetModelId} (Session: ${session.id})`);
      
      let fullContent = '';
      let wasCancelled = false;
      let doneSent = false;
      let finalUsage: any = null;
      
      // Use provided cancellation token or create a dummy one
      const token = cancellationToken || { isCancellationRequested: false, onCancelled: () => {} } as any;

      // Progress reporter that forwards language model parts back to the webview
      const progressReporter: vscode.Progress<vscode.LanguageModelResponsePart> = {
        report: (part: vscode.LanguageModelResponsePart) => {
          try {
            const anyPart = part as any;
            // Tool call (assistant -> function)
            if (anyPart && typeof anyPart.callId === 'string' && 'name' in anyPart) {
              // Cast to any to bypass strict type checking – the webview expects this shape.
              onChunk({
                type: 'toolCall',
                id: anyPart.callId,
                name: anyPart.name,
                arguments: anyPart.arguments || anyPart.input || anyPart.function?.arguments || ''
              } as any);
              return;
            }

            // Tool result (function -> assistant)
            if (anyPart && typeof anyPart.callId === 'string' && 'content' in anyPart) {
              const content = typeof anyPart.content === 'string' ? anyPart.content : JSON.stringify(anyPart.content);
              onChunk({ content });
              return;
            }

            // Text part
            if (anyPart && 'value' in anyPart) {
              onChunk({ content: String(anyPart.value) });
              return;
            }
          } catch (e) {
            this.logger.error(`progressReporter.report failed: ${e}`);
          }
        }
      };

      // Bridge VS Code CancellationToken to AbortSignal for the client
      const abortCtrl2 = new AbortController();
      if (typeof token.onCancellationRequested === 'function') {
        token.onCancellationRequested(() => abortCtrl2.abort());
      } else if (typeof (token as any).onCancelled === 'function') {
        (token as any).onCancelled(() => abortCtrl2.abort());
      }
      const requestStartTime = Date.now();
      //starting the streaming request to the inference server...
      for await (const chunk of this.client.streamChatCompletion(requestOptions, abortCtrl2.signal)) {
          // Check for cancellation at the start of each iteration
          if (token.isCancellationRequested) {
            this.logger.info('Streaming cancelled by user (detected in loop)');
            wasCancelled = true;
            break;
          }
          
          if (chunk.reasoning_content) {
            onChunk({ content: chunk.reasoning_content, type:'reasoning' });
          }

          // Forward normal content chunks
          if (chunk.content) {
            fullContent += chunk.content;
            onChunk({ content: chunk.content });
          }
          
          // Forward tool calls if present and execute them automatically
          if (chunk.finished_tool_calls && chunk.finished_tool_calls.length > 0) {
            for (const toolCall of chunk.finished_tool_calls) {
              // Store the progress reporter so we can later send the result back (kept for compatibility)
              this.pendingToolCalls.set(toolCall.id, progressReporter);
              // Parse arguments and report the tool call part to the UI
              const parsedArgs = this.processToolCall(toolCall, progressReporter);
              parsedArgs.toolInvokationToken = toolCall.id;
              // Persist the tool call into the session for logging
              try {
                this.sessionManager.addMessage('tools', 'tool', JSON.stringify({ name: toolCall.name, arguments: parsedArgs }), { toolCallId: toolCall.id, toolCalls: [{ id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }], modelId: targetModelId });
              } catch (e) {
                this.logger.error(`Failed to persist streaming tool call in session: ${e}`);
              }
              // Execute the tool automatically and send the result back to the model
              try {
                const toolResult = await this.executeTool(toolCall.name, parsedArgs);
                // Report the result back via the same progress reporter
                progressReporter.report(new vscode.LanguageModelToolResultPart(toolCall.id, toolResult as any));
                // Clean up pending map
                this.pendingToolCalls.delete(toolCall.id);
              } catch (e) {
                this.logger.error(`Tool execution failed for ${toolCall.name}: ${e}`);
                // Still report an empty result to avoid hanging the stream
                progressReporter.report(new vscode.LanguageModelToolResultPart(toolCall.id, {} as any));
                this.pendingToolCalls.delete(toolCall.id);
              }
            }
          }
          
          // Check if usage is included in the chunk (final chunk)
          if (chunk.usage) {
            finalUsage = chunk.usage;
            
            // Calculate token speed: tokens per second
            const durationMs = Date.now() - requestStartTime;
            const completionTokens = chunk.usage.completion_tokens || 0;
            if (durationMs > 0 && completionTokens > 0) {
              const tokensPerSecond = completionTokens / (durationMs / 1000);
              // Add token speed to usage object
              finalUsage.tokenSpeed = tokensPerSecond;
              
              // Also add duration for UI display
              finalUsage.durationMs = durationMs;
            }
            
            onChunk({ usage: chunk.usage, done: true });
            doneSent = true;
          }
        }
      
      // Check if cancellation was requested (might not have been detected in loop if stream ended)
      if (token.isCancellationRequested) {
        wasCancelled = true;
      }
      
      if (wasCancelled) {
        this.logger.info('Calling onChunk with cancelled=true');
        onChunk({ done: true, cancelled: true });
      } else if (!doneSent) {
        // Stream ended normally - send done message if not already sent with usage
        this.logger.info('Streaming complete, sending done message');
        onChunk({ done: true });
      }
      
      // Add agent response to session if we have content
      if (fullContent && !wasCancelled) {
        this.sessionManager.addMessage('agent', 'assistant', fullContent);
      }

      // Record usage statistics with token tracking by type
      if (finalUsage && this.statsManager) {
        await this.statsManager.recordChatUsage(finalUsage, targetModelId);
        
        // Update session token usage by type
        if (finalUsage.prompt_tokens && finalUsage.completion_tokens) {
          const promptTokens = finalUsage.prompt_tokens;
          const completionTokens = finalUsage.completion_tokens;
          
          // Add agent response tokens
          this.sessionManager.updateTokenUsage('agent', 0, completionTokens);
          
          // Estimate input tokens distribution
          this.sessionManager.updateTokenUsage('user', Math.floor(promptTokens * 0.6), 0);
          this.sessionManager.updateTokenUsage('prompt', Math.floor(promptTokens * 0.2), 0);
          this.sessionManager.updateTokenUsage('context', Math.floor(promptTokens * 0.2), 0);
        }
      }
      
      this.logger.info(`Streaming complete, total length: ${fullContent.length}`);
    } catch (error) {
      this.logger.error(`Failed to stream message: ${error}`);
      throw error;
    }
  }

  /**
   * Called by the webview when the user provides a result for a tool call.
   * It looks up the stored progress reporter for the given toolCallId and
   * reports the result back to the language model stream so the provider can
   * continue processing.
   */
  public receiveToolResult(toolCallId: string, result: unknown): void {
    const progress = this.pendingToolCalls.get(toolCallId);
    if (!progress) {
      this.logger.warn(`Received tool result for unknown toolCallId ${toolCallId}`);
      return;
    }
    // Report the tool result back to the model stream
    try {
      progress.report(new vscode.LanguageModelToolResultPart(toolCallId, result as any));
    } catch (e) {
      this.logger.error(`Failed to report tool result for ${toolCallId}: ${e}`);
    }
    // Clean up the pending entry
    this.pendingToolCalls.delete(toolCallId);
  }

  /**
   * Generate a session title using the small model (or default model as fallback)
   * @param firstMessage The first user message to summarize
   * @param sessionId The session ID to update with the generated title
   */
  public async generateSessionTitle(firstMessage: string, sessionId: string): Promise<string> {
    // Reuse any in‑flight title generation for this session
    const existing = this.titlePromises.get(sessionId);
    if (existing) {
      this.logger.debug(`Reusing pending title generation for session ${sessionId}`);
      return existing;
    }

    const titlePromise = (async () => {
      await this.initializationPromise;
      const config = vscode.workspace.getConfiguration('private.model.provider');
      const smallModelId = config.get<string>('smallModel', '');
      const targetModelId = smallModelId || config.get<string>('defaultModel', '');
      if (!targetModelId) {
        this.logger.warn('No model available for title generation, keeping default title');
        return '';
      }
      this.logger.info(`Generating session title using model: ${targetModelId} (smallModel: ${smallModelId || 'none'})`);

      // Build prompt (custom template support)
      let summaryPrompt = `Provide a concise title (10 words or less) for a conversation that starts with this message: "${firstMessage}"`;
      const workspaceRoot = this.getWorkspaceRoot();
      if (workspaceRoot) {
        const customTemplatePath = path.join(workspaceRoot, '.llm', 'session.summary.md');
        try {
          if (fs.existsSync(customTemplatePath)) {
            const template = fs.readFileSync(customTemplatePath, 'utf-8');
            summaryPrompt = template.replace(/\{\{message\}\}/g, firstMessage);
            this.logger.info(`Using custom summary template from ${customTemplatePath}`);
          }
        } catch (e) {
          this.logger.warn(`Failed to read custom summary template: ${e}`);
        }
      }

      const requestOptions: any = {
        model: targetModelId,
        messages: [{ role: 'user', content: summaryPrompt }],
        max_tokens: 50,
        temperature: 0,
        stream: false,
      };

      try {
        const response = await this.client.completeChat(requestOptions);
        let title = response.choices?.[0]?.message?.content || '';
        title = title.replace(/^['"]|['"]$/g, '').trim();
        if (title.length > 50) {
          title = title.substring(0, 47) + '...';
        }
        if (title) {
          this.sessionManager.updateSessionTitle(sessionId, title);
          this.logger.info(`Generated session title: "${title}"`);
          return title;
        }
        return '';
      } catch (e) {
        this.logger.error(`Failed to generate session title: ${e}`);
        return '';
      }
    })();

    this.titlePromises.set(sessionId, titlePromise);
    titlePromise.finally(() => this.titlePromises.delete(sessionId));
    return titlePromise;
  }
}
