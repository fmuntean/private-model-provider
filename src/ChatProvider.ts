/**
 * ChatProvider — Full VS Code extension provider with all features.
 * This class extends CopilotProvider and adds session management, MCP servers,
 * secret management, statistics tracking, logging, and webview integration.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CopilotProvider } from './CopilotProvider';
import { GatewayConfig, ChatSession, MessageChunk } from './types';
import { Logger } from './vscodeLogger';
import { LlmClient } from './core/llmClient';
import { MCPManager } from './mcp';
import { SecretManager } from './secretManager';
import { StatisticsManager } from './statistics';
import { SessionManager } from './sessionManager';
import { runCopilotTool, runInTerminalLocal } from './tools';
import { IllmClientConfig } from './core/interfaces';
import { 
  Message, 
  MessageRole, 
  MessageContent, 
  ToolCall, 
  ToolDefinition, 
  TokenUsage,
  AIRequest,
  AIResponse,
  StreamChunk,
  RequestOptions
} from './core/chatMessages';

/**
 * ChatProvider is the full-featured provider for the Private LLM extension.
 * It extends CopilotProvider with session management, MCP servers, and webview integration.
 */
export class ChatProvider extends CopilotProvider {
  private readonly context: vscode.ExtensionContext;
  private readonly mcpManager: MCPManager;
  private readonly statsManager: StatisticsManager | null;
  private readonly sessionManager: SessionManager;
  private hasShownWelcomeNotification = false;
  private readonly titlePromises: Map<string, Promise<string>> = new Map();
  private readonly initializationPromise: Promise<void>;
  // Event emitter for model list changes
  //private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  constructor(
    context: vscode.ExtensionContext,
    logger: Logger,
    config: GatewayConfig,
    client: LlmClient,
    mcpManager: MCPManager,
    statsManager: StatisticsManager | null,
    sessionManager: SessionManager
  ) {
    super(logger, config, client);
    this.context = context;
    this.mcpManager = mcpManager;
    this.statsManager = statsManager;
    this.sessionManager = sessionManager;

    // Initialize API key from secure storage (store promise for awaiting later)
    this.initializationPromise = this.initializeApiKey();


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

    // Start MCP servers asynchronously
    this.mcpManager.startAll().catch(err => this.logger.error('Failed to start MCP servers', err));
  }


  /**
   * Refresh the model cache and notify listeners.
   */
  public async refreshModels(): Promise<vscode.LanguageModelChatInformation[]> {
    // Clear existing cache first
    this.clearModelCache();
    // Fetch fresh models (silent false to allow UI messages if needed)
    const models = await this.provideLanguageModelChatInformation(
      { silent: false },
      new vscode.CancellationTokenSource().token
    );
    // Fire change event to notify UI of the new list
    (this as any)._onDidChangeLanguageModelChatInformation.fire();
    return models;
  }

  /**
   * Immediately reload configuration and update HTTP client.
   */
  public async applyLatestConfiguration(): Promise<void> {
    // Reuse existing reload logic
    this.reloadConfig();
    // Clear model cache on config change
    this.clearModelCache();
  }



  /**
   * Send a simple message from the chat webview and return the response.
   */
  public async sendMessage(text: string, modelId?: string, sessionId?: string, contextFiles?: string[]): Promise<{ content: string; usage?: TokenUsage }> {
    await this.initializationPromise;
    this.logger.info(`sendMessage called with text: ${text.substring(0, 50)}..., modelId: ${modelId}, sessionId: ${sessionId}, contextFiles: ${contextFiles?.length || 0}`);

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
      session = (this.sessionManager as any)['sessions'].get(sessionId) || null;
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

    // Add context files to session messages if provided
    if (contextFiles && contextFiles.length > 0) {
      for (const filePath of contextFiles) {
        try {
          const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
          const content = `File: ${filePath}\n\`\`\`\n${fileContent.toString()}\n\`\`\``;
          this.sessionManager.addMessage('context', 'system', content);
          this.logger.info(`Added file context: ${filePath}`);
        } catch (error) {
          this.logger.error(`Failed to read context file ${filePath}: ${error}`);
        }
      }
    }

    // Generate session title if this is a new session
    if (isNewSession) {
      try {
        await this.generateSessionTitle(text, session.id);
      } catch (err) {
        this.logger.error(`Failed to generate session title: ${err}`);
      }
    }

    // Build the request with conversation history using unified Message type
    const messages: Message[] = [];
    
    // Add conversation history from session
    for (const msg of session.messages) {
      if (msg.role === 'system' && msg.type === 'prompt') {
        // Skip if we already added the master prompt
        if (messages.length === 0 || messages[0].role !== 'system') {
          messages.push({ role: 'system' as MessageRole, content: msg.content });
        }
      } else {
        messages.push({ 
          role: msg.role as MessageRole, 
          content: msg.content
        });
      }
    }

    const requestOptions: any = {
      model: targetModelId,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: this.config.defaultMaxOutputTokens || 2048,
      temperature: 0.7,
      stream: false,
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
      const allTools = getToolDefinitions();
      // Apply user‑selected enable filter for MCP tools
      const enabledMcpTools: string[] = vscode.workspace
        .getConfiguration('private.model.provider')
        .get<string[]>('enabledMcpTools', []);
      // If the user has specified a whitelist, keep only those tools whose name matches.
      if (enabledMcpTools.length > 0) {
        requestOptions.tools = allTools.filter((t: any) => {
          const name = t.function?.name ?? t.name;
          // Core extension tools are always allowed; MCP tools are identified by being absent from the base list.
          const coreToolNames = ['readFile', 'semanticSearch', 'askQuestions', 'applyPatch', 'runInTerminal'];
          if (coreToolNames.includes(name)) return true;
          return enabledMcpTools.includes(name);
        });
      } else {
        requestOptions.tools = allTools;
      }
    }

    try {
      this.logger.info(`Sending message to model: ${targetModelId} (Session: ${session.id})`);
      // Send the request directly to the inference server using the existing client.
      const response = await this.requestWithRetry(() => this.client.completeChat(requestOptions));
      const content = (response as any).choices?.[0]?.message?.content || '';
      
      // Map OpenAI API response (snake_case) to TokenUsage interface (camelCase)
      const rawUsage = (response as any).usage;
      const usage: TokenUsage | undefined = rawUsage ? {
        inputTokens: rawUsage.prompt_tokens,
        outputTokens: rawUsage.completion_tokens,
        totalTokens: rawUsage.total_tokens,
        cachedTokens: rawUsage.cached_tokens
      } : undefined;

      // Add agent response to session
      if (content) {
        this.sessionManager.addMessage('agent', 'assistant', content);
      }

      // Record usage statistics with token tracking by type
      if (usage && this.statsManager) {
        await this.statsManager.recordChatUsage(usage as any, targetModelId);
        
        // Update session token usage by type
        if (usage.inputTokens && usage.outputTokens) {
          const promptTokens = usage.inputTokens;
          const completionTokens = usage.outputTokens;
          
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
      session = (this.sessionManager as any)['sessions'].get(sessionId) || null;
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

    // Generate session title if this is a new session (fire and forget)
    if (isNewSession) {
      this.generateSessionTitle(text, session.id).catch(err => {
        this.logger.error(`Failed to generate session title: ${err}`);
      });
    }

    // Build the request with conversation history using unified Message type
    const messages: Message[] = [];
    
    // Add conversation history from session
    for (const msg of session.messages) {
      if (msg.role === 'system' && msg.type === 'prompt') {
        if (messages.length === 0 || messages[0].role !== 'system') {
          messages.push({ role: 'system' as MessageRole, content: msg.content });
        }
      } else {
        messages.push({ 
          role: msg.role as MessageRole, 
          content: msg.content
        });
      }
    }

    
    const requestOptions: RequestOptions = {
      model: targetModelId,
      maxTokens: this.config.defaultMaxOutputTokens || 2048,
      temperature: this.config.agentTemperature || 0.1
    };

    // Add tooling if tool calling is enabled
    if (this.config.enableToolCalling) {
      const { getToolDefinitions } = require('./tools');
      requestOptions.tools = getToolDefinitions();
    }
    
    try {
      this.logger.info(`Streaming message to model: ${targetModelId} (Session: ${session.id})`);
      
      let fullContent = '';
      let wasCancelled = false;
      let doneSent = false;
      let finalUsage: TokenUsage | null = null;
      
      const token = cancellationToken || { isCancellationRequested: false, onCancelled: () => {} } as any;

      const progressReporter: vscode.Progress<vscode.LanguageModelResponsePart> = {
        report: (part: vscode.LanguageModelResponsePart) => {
          try {
            const anyPart = part as any;
            // Tool call (assistant -> function)
            if (anyPart && typeof anyPart.callId === 'string' && 'name' in anyPart) {
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
      const abortCtrl = new AbortController();
      if (typeof token.onCancellationRequested === 'function') {
        token.onCancellationRequested(() => abortCtrl.abort());
      } else if (typeof (token as any).onCancelled === 'function') {
        (token as any).onCancelled(() => abortCtrl.abort());
      }

      const requestStartTime = Date.now();
      const request:AIRequest = {
        messages:messages,
        options: requestOptions
      }
      for await (const chunk of this.client.streamChatCompletion(request, abortCtrl.signal)) {
        if (token.isCancellationRequested) {
          this.logger.info('Streaming cancelled by user (detected in loop)');
          wasCancelled = true;
          break;
        }
        
        if (chunk.reasoning_content) {
          onChunk({ content: chunk.reasoning_content, type: 'reasoning' });
        }

        // Forward normal content chunks
        if (chunk.content) {
          fullContent += chunk.content;
          onChunk({ content: chunk.content });
        }
        
        // Forward tool calls if present
        if (chunk.finished_tool_calls && chunk.finished_tool_calls.length > 0) {
          for (const toolCall of chunk.finished_tool_calls) {
            // Create a properly typed ToolCall
            const typedToolCall: ToolCall = {
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments
            };
            
            // Store the progress reporter
            (this as any).pendingToolCalls.set(typedToolCall.id, progressReporter);
            // Parse arguments and report the tool call part to the UI
            const parsedArgs = this.tryRepairJson(toolCall.arguments) as Record<string, unknown>;
            parsedArgs.toolInvokationToken = typedToolCall.id;
            // Clean up
            (this as any).pendingToolCalls.delete(typedToolCall.id);
          }
        }
        
        // Check if usage is included in the chunk (final chunk)
        if (chunk.usage) {
          // Map OpenAI API response (snake_case) to TokenUsage interface (camelCase)
          finalUsage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens
          };
          
          // Calculate token speed (handled separately from TokenUsage)
          const durationMs = Date.now() - requestStartTime;
          const completionTokens = chunk.usage.completion_tokens || 0;
          let tokenSpeed: number | undefined;
          if (durationMs > 0 && completionTokens > 0) {
            tokenSpeed = completionTokens / (durationMs / 1000);
          }
          
          // Send usage with performance metrics to UI
          onChunk({ usage: { ...chunk.usage, tokenSpeed, durationMs }, done: true });
          doneSent = true;
        }
      }
      
      if (token.isCancellationRequested) {
        wasCancelled = true;
      }
      
      if (wasCancelled) {
        this.logger.info('Calling onChunk with cancelled=true');
        onChunk({ done: true, cancelled: true });
      } else if (!doneSent) {
        this.logger.info('Streaming complete, sending done message');
        onChunk({ done: true });
      }
      
      // Add agent response to session if we have content
      if (fullContent && !wasCancelled) {
        this.sessionManager.addMessage('agent', 'assistant', fullContent);
      }

      // Record usage statistics
      if (finalUsage && this.statsManager) {
        await this.statsManager.recordChatUsage(finalUsage as any, targetModelId);
        
        // Update session token usage by type
        if (finalUsage.inputTokens && finalUsage.outputTokens) {
          const promptTokens = finalUsage.inputTokens;
          const completionTokens = finalUsage.outputTokens;
          
          this.sessionManager.updateTokenUsage('agent', 0, completionTokens);
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
   */
  public receiveToolResult(toolCallId: string, result: unknown): void {
    const progress = (this as any).pendingToolCalls.get(toolCallId);
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
    (this as any).pendingToolCalls.delete(toolCallId);
  }

  /**
   * Generate a session title using the small model (or default model as fallback)
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
        let title = (response as any).choices?.[0]?.message?.content || '';
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

  // Private helper methods

  private async initializeApiKey(): Promise<void> {
    try {
      const apiKey = await SecretManager.getClientApiKey();
      if (apiKey) {
        const clientConfig = this.buildClientConfig(apiKey);
        this.client.updateConfig(clientConfig);
        this.logger.info('API key loaded from secure storage');
      }
    } catch (error) {
      this.logger.error('Failed to load API key:', error);
    }
  }

  private getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return this.context.globalStorageUri.fsPath;
  }

  private reloadConfig(): void {
    this.config = this.loadConfig();
    const clientConfig = this.buildClientConfig();
    this.client.updateConfig(clientConfig);
    this.logger.info('Configuration reloaded');
  }

  private buildClientConfig(apiKey?: string): IllmClientConfig {
    const config = vscode.workspace.getConfiguration('private.model.provider');
    
    // Normalize server URL (remove trailing slash and optional /v1 segment)
    let serverUrlRaw = config.get<string>('serverUrl', 'http://localhost:8000');
    if (/\/v1\/?$/.test(serverUrlRaw)) {
      serverUrlRaw = serverUrlRaw.replace(/\/v1\/?$/, '');
    }
    if (/\/$/.test(serverUrlRaw)) {
      serverUrlRaw = serverUrlRaw.replace(/\/+$/, '');
    }

    return {
      serverUrl: serverUrlRaw,
      apiKey: apiKey ?? (this.config as any).apiKey ?? '',
      requestTimeout: config.get<number>('requestTimeout', 60000),
    };
  }

  private loadConfig(): GatewayConfig {
    const config = vscode.workspace.getConfiguration('private.model.provider');
    const previousApiKey = (this.config as any)?.apiKey ?? '';

    // Normalize server URL (remove trailing slash and optional /v1 segment)
    let serverUrlRaw = config.get<string>('serverUrl', 'http://localhost:8000');
    // Remove trailing /v1 if present
    if (/\/v1\/?$/.test(serverUrlRaw)) {
      serverUrlRaw = serverUrlRaw.replace(/\/v1\/?$/, '');
      this.logger.info('NOTE: Stripped trailing /v1 from serverUrl setting to avoid duplicated path.');
    }
    // Remove any trailing slash
    if (/\/$/.test(serverUrlRaw)) {
      serverUrlRaw = serverUrlRaw.replace(/\/+$/, '');
      this.logger.info('NOTE: Stripped trailing slash from serverUrl setting.');
    }

    const cfg: GatewayConfig = {
      defaultMaxTokens: config.get<number>('defaultMaxTokens', 32768),
      defaultMaxOutputTokens: config.get<number>('defaultMaxOutputTokens', 4096),
      enableToolCalling: config.get<boolean>('enableToolCalling', true),
      parallelToolCalling: config.get<boolean>('parallelToolCalling', true),
      agentTemperature: config.get<number>('agentTemperature', 0),
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



  // Helper method: addTooling
  private addTooling(
    requestOptions: any,
    options: vscode.ProvideLanguageModelChatResponseOptions
  ): void {
    // Combine built‑in tools (from the request) with any MCP tools configured by the user.
    const toolSchemas: ToolDefinition[] = [];

    // First, include any tools passed in via the request options (e.g., from the chat UI).
    if (options.tools && options.tools.length > 0) {
      toolSchemas.push(
        ...options.tools.map((tool): ToolDefinition => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || {},
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
      requestOptions.tools = toolSchemas.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }
      }));
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

          // Create a properly typed ToolCall
          const typedToolCall: ToolCall = {
            id: toolCall.id,
            name: toolCall.name,
            arguments: args
          };

          // Report the tool call to the UI so the user sees the pending call
          progress.report(new vscode.LanguageModelToolCallPart(
            typedToolCall.id,
            typedToolCall.name,
            args as object
          ));

          // Store a progress reporter for the eventual tool result (used elsewhere if needed)
          this.pendingToolCalls.set(typedToolCall.id, progress);

          // Execute the tool and report the result back to the model
          (async () => {
            try {
              const result = await this.executeTool(typedToolCall.name, args as Record<string, unknown>);
              // Convert result to a plain object for the tool result part
              const resultObj = typeof result === 'object' && result !== null ? result : { value: result };
              // LanguageModelToolResultPart expects either a string or an array. Cast to any to satisfy overload.
              progress.report(new vscode.LanguageModelToolResultPart(
                typedToolCall.id,
                JSON.stringify(resultObj) as any
              ));
            } catch (e) {
              this.logger.error(`Tool execution failed for ${typedToolCall.name}: ${e instanceof Error ? e.message : String(e)}`);
              // Report an error result so the model can continue
              progress.report(new vscode.LanguageModelToolResultPart(
                typedToolCall.id,
                JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) as any
              ));
            } finally {
              // Clean up pending map
              this.pendingToolCalls.delete(typedToolCall.id);
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
        this.logger.warn(`Tool "${name}" is not recognized - falling back to generic execution`);
        return await runCopilotTool(name, args);
    }
  }
}
