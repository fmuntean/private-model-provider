import * as vscode from 'vscode';
import * as fs from 'fs';
import { GatewayProvider } from './provider';
import { StatusBarManager, ServerStatus, ServerPreset } from './statusBar';
import { StatisticsManager } from './statistics';
import { SessionManager } from './sessionManager';
import { registerSessionView } from './ui/sessionView';
import { registerChatView } from './ui/chatView';
import { getLogger, Logger } from './vscodeLogger';
import { PromptManager } from './prompts';
import { LlmClient } from './llmClient';
import * as command from './commands';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
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

  // Create and register the language model provider
  // This is the provider that handles the communication with 
  // the inference server when called from other chat extensions 
  // like Github Copilot Chat
  const provider = new GatewayProvider(context, statsManager, sessionManager);
  const chatProvider = vscode.lm.registerLanguageModelChatProvider(
    'private-model-provider',
    provider
  );
  context.subscriptions.push(chatProvider);

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
    async () => command.setApiKey(provider)
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
  async function runHealthCheck(statusBar: StatusBarManager, provider: GatewayProvider) {
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
