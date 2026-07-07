import * as vscode from 'vscode';
import { ChatProvider } from './ChatProvider';
import { StatusBarManager, ServerStatus } from './statusBar';
import { StatisticsManager } from './statistics';
import { SessionManager } from './sessionManager';
import { registerSessionView } from './ui/sessionView';
import { registerChatView } from './ui/chatView';
import { getLogger, Logger } from './vscodeLogger';
import { LlmClient } from './core/llmClient';
import { MCPManager } from './mcp';
import { SecretManager } from './secretManager';
import * as command from './commands';
import { CopilotProvider } from './CopilotProvider';
import { GatewayConfig } from './types';
import { GeminiClient } from './core/geminiClient';
import { getClientConfig, getGeminiConfig } from './config';
import { IllmClientConfig } from './core/interfaces';

//---------------------------------------------------------------
// https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider
//---------------------------------------------------------------


/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Private LLM');
  const logger = Logger.getInstance('Private LLM', outputChannel);
  
  logger.info('Private Model Provider extension is now active');

  
  // Create statistics manager
  const statsManager = new StatisticsManager();
  context.subscriptions.push(statsManager);

  // Create session manager and register session view
  const sessionManager = new SessionManager(context);
  const sessionViewProvider = registerSessionView(context, sessionManager);
  context.subscriptions.push(sessionManager);

  // Create status bar manager
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  // Link stats to status bar
  statsManager.onStatsUpdate((stats) => {
    statusBar.updateStats(stats);
  });

  
  
  // Initialize SecretManager with extension context (must be done first)
  const secretManager = SecretManager.initialize(context);

  // Load configuration to create client
  const config = vscode.workspace.getConfiguration('private.model.provider');

  const gatewayConfig: GatewayConfig = {
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

  // Get LLM client config with secure API key
  const llmConfig: IllmClientConfig = await getClientConfig(secretManager);

  // Create LLM client
  const llmClient = new LlmClient(llmConfig, {
    maxRetries: gatewayConfig.maxRetries,
    baseDelayMs: gatewayConfig.retryDelayMs,
  });

  // Create managers
  const mcpManager = new MCPManager();


  // Create and register the language model provider
  // This is the provider that handles the communication with 
  // the inference server when called from other chat extensions 
  // like Github Copilot Chat
  const provider1 = new CopilotProvider(
    logger,
    gatewayConfig,
    llmClient
  );
  
  const copilotProvider = vscode.lm.registerLanguageModelChatProvider(
    'private-model-provider',
    provider1
  );
  context.subscriptions.push(copilotProvider);

  // Create and register the Gemini client and provider
  const geminiClientConfig: IllmClientConfig = await getGeminiConfig(secretManager);
  const geminiClient = new GeminiClient(geminiClientConfig);
  const provider2 = new CopilotProvider(
    logger,
    gatewayConfig,
    geminiClient
  );
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(
    'private-model-provider-gemini',
    provider2
  ));

  // Create and register the chat provider for the sidebar
  const provider = new ChatProvider(
    context,
    logger,
    gatewayConfig,
    llmClient,
    mcpManager,
    statsManager,
    sessionManager
  );

  // Register the chat sidebar webview
  const chatViewProvider = registerChatView(context, provider, sessionManager);
  context.subscriptions.push(chatViewProvider);

  // Store chatViewProvider in a way that commands can access it
  const chatViewProviderRef = { current: chatViewProvider };

  // Get server URL for status bar
  // Initial health check
  runHealthCheck(statusBar, provider);

  // Re‑run health check when the server URL changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('private.model.provider.serverUrl')) {
        const newUrl = vscode.workspace
          .getConfiguration('private.model.provider')
          .get<string>('serverUrl', 'http://localhost:8000');
        statusBar.setStatus(ServerStatus.Unknown, { serverUrl: newUrl });
        runHealthCheck(statusBar, provider);
      }
      // When the default model changes, persist it to the active session
      if (e.affectsConfiguration('private.model.provider.defaultModel')) {
        const newModel = vscode.workspace
          .getConfiguration('private.model.provider')
          .get<string>('defaultModel', '');
        if (newModel) {
          sessionManager.setActiveSessionModel(newModel);
        }
      }
    })
  );



  // Register command to set API key securely
  const setApiKeyCommand = vscode.commands.registerCommand(
    'private-model-provider.setApiKey',
    async () => command.setApiKey()
  );

  // Register command to show status menu
  const showStatusCommand = vscode.commands.registerCommand(
    'private-model-provider.showStatus',
    () => statusBar.showStatusMenu()
  );

  // Register command to view and select models
  const selectModelCommand = vscode.commands.registerCommand(
    'private-model-provider.selectModel',
    async () => command.selectModel(provider, statusBar)
  );

  // Register command to switch server presets
  const switchServerCommand = vscode.commands.registerCommand(
    'private-model-provider.switchServer',
    async () => command.switchServer(provider, statusBar)
    );

  // Register command to show statistics
  const showStatsCommand = vscode.commands.registerCommand(
    'private-model-provider.showStats',
    async () => command.showStats(statsManager)  
  );

  // Register command to refresh model cache
  const refreshModelsCommand = vscode.commands.registerCommand(
    'private-model-provider.refreshModels',
    async () => command.refreshModels(chatViewProviderRef,provider, statusBar)
  );


  // Register command to generate system prompts using PromptManager
  const generateSystemPromptsCommand = vscode.commands.registerCommand(
    'private-model-provider.generateSystemPrompts',
    async () => command.generateSystemPrompts(context, provider, chatViewProviderRef)
  );

  // Register command to test server connection
  const testConnectionCommand = vscode.commands.registerCommand(
    'private-model-provider.testConnection',
    async () => command.testConnection(provider)
  );


  // Register command to show output channel
  const showOutputCommand = vscode.commands.registerCommand(
    'private-model-provider.showOutput',
    () => {
      //provider.getOutputChannel().show();
      outputChannel.show();
    }
  );

  context.subscriptions.push(setApiKeyCommand);
  context.subscriptions.push(showStatusCommand);
  context.subscriptions.push(testConnectionCommand);     // Add test connection command to subscriptions
  context.subscriptions.push(selectModelCommand);
  context.subscriptions.push(switchServerCommand);
  
  // ---------------------------------------------------------------
  // MCP Server management commands
  // ---------------------------------------------------------------

  // Register command to allow users to select which MCP tools are enabled
  const selectMcpToolsCommand = vscode.commands.registerCommand(
    'private-model-provider.selectMcpTools',
    async () => command.selectMcpTools(provider)
  );
  

  const startMcpCommand = vscode.commands.registerCommand(
    'private-model-provider.startMcpServers',
    async () => command.startMcpServers(provider)
  );

  const stopMcpCommand = vscode.commands.registerCommand(
    'private-model-provider.stopMcpServers',
    async () => command.stopMcpServers(provider)
  );


  // Register MCP server management commands
  context.subscriptions.push(startMcpCommand);
  context.subscriptions.push(stopMcpCommand);
  context.subscriptions.push(showStatsCommand);
  context.subscriptions.push(refreshModelsCommand);
  context.subscriptions.push(generateSystemPromptsCommand);
  context.subscriptions.push(showOutputCommand);
  // Register the select MCP tools command so it is disposed correctly
  context.subscriptions.push(selectMcpToolsCommand);

  // Watch for config changes to update status bar
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('private.model.provider.serverUrl')) {
        const newConfig = vscode.workspace.getConfiguration('private.model.provider');
        const newServerUrl = newConfig.get<string>('serverUrl', 'http://localhost:8000');
        statusBar.setStatus(ServerStatus.Unknown, { serverUrl: newServerUrl });
      }
      
      // Clear model cache when defaultModel changes to force VS Code to refresh
      if (e.affectsConfiguration('private.model.provider.defaultModel')) {
        provider.clearModelCache();
      }
    })
  );

  logger.info('Private Model Provider registered with vendor ID: private-model-provider');
}

/**
 * Extension deactivation
 */
export function deactivate() {
  const logger = getLogger();
  logger.info('Private Model Provider extension is now deactivated');
}


  // ---------------------------------------------------------------------
  // Health‑check: verify server connectivity on activation and when the
  // server URL changes. The check simply attempts to fetch the model list.
  // ---------------------------------------------------------------------
  async function runHealthCheck(statusBar: StatusBarManager, provider: ChatProvider) {
    const config = vscode.workspace.getConfiguration('private.model.provider');
    const serverUrl = config.get<string>('serverUrl', 'http://localhost:8000');
    statusBar.setStatus(ServerStatus.Unknown, { serverUrl });

    try {
      const serverUrl = config.get<string>('serverUrl', 'http://localhost:8000');
      // Silent request – we only care about success/failure
      const models = await provider.provideLanguageModelChatInformation(
        { silent: true },
        new vscode.CancellationTokenSource().token
      );
      const modelCount = models.length;
      statusBar.setStatus(ServerStatus.Connected, { modelCount, serverUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusBar.setStatus(ServerStatus.Error, { errorMessage: msg, serverUrl });
    }
  };
