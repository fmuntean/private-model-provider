import * as vscode from 'vscode';
import * as fs from 'fs';
import { GatewayProvider } from './provider';
import { StatusBarManager, ServerStatus, ServerPreset } from './statusBar';
import { StatisticsManager } from './statistics';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('[LMP] Local Model Provider extension is now active');


  // Forward messages from UI to the provider
  const sendMessageCommand = vscode.commands.registerCommand(
    'localModelProvider.sendMessage',
    async (text: string, model?: string) => {
      try {
        const response = await provider.sendMessage(text, model);
        // Send response to sidebar webview
        sideBar?.postMessage({
          type: 'assistant',
          content: response.content,
          usage: response.usage
        });
      } catch (err) {
        sideBar?.postMessage({
          type: 'error',
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  );
  context.subscriptions.push(sendMessageCommand);

  // Provide token stats on request
  const getStatsCommand = vscode.commands.registerCommand(
    'localModelProvider.getStats',
    () => {
      const stats = statsManager.getSessionStats();
      sideBar?.postMessage({
        type: 'stats',
        stats
      });
    }
  );
  context.subscriptions.push(getStatsCommand);

  // Create statistics manager
  const statsManager = new StatisticsManager();
  context.subscriptions.push(statsManager);

  // Create status bar manager
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  // Link stats to status bar
  statsManager.onStatsUpdate((stats) => {
    statusBar.updateStats(stats);
  });

  // Create and register the language model provider
  const provider = new GatewayProvider(context, statsManager);

  const disposable = vscode.lm.registerLanguageModelChatProvider(
    'local-model-provider',
    provider
  );

  context.subscriptions.push(disposable);

  // ---------------------------------------------------------------------
  // Register side‑bar webview view (for the secondary side bar)
  // ---------------------------------------------------------------------
  class ChatSideBarProvider implements vscode.WebviewViewProvider {
    private webviewView: vscode.WebviewView | undefined;
    private currentCancellationSource: vscode.CancellationTokenSource | undefined;

    constructor(
      private readonly extensionUri: vscode.Uri,
      private readonly provider: GatewayProvider
    ) {}

    /** Post message to the webview */
    public postMessage(data: any): void {
      this.webviewView?.webview.postMessage(data);
    }

    /** Resolve the webview view when the side‑bar panel is shown */
    public async resolveWebviewView(webviewView: vscode.WebviewView) {
      try {
        console.log('[LMP] Resolving side‑bar view: localModelProvider.chat');
        // Enable scripts and allow loading of CSS/JS from the assets folder
        webviewView.webview.options = {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'assets')]
        };

        // Build the HTML from index.html file
        const scriptUri = webviewView.webview.asWebviewUri(
          vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'assets', 'main.js')
        );
        const styleUri = webviewView.webview.asWebviewUri(
          vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'assets', 'style.css')
        );
        const nonce = getNonce();
        
        // Load HTML from file
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'assets', 'index.html').fsPath;
        let html: string;
        try {
          html = require('fs').readFileSync(htmlPath, 'utf-8');
        } catch (e) {
          console.error('[LMP] Failed to read index.html:', e);
          html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewView.webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Local Model Chat</title>
</head>
<body>
  <div id="chat-container"></div>
  <div id="input-bar">
    <textarea id="user-input" rows="2" placeholder="Type a message..."></textarea>
    <button id="send-btn">Send</button>
  </div>
  <div id="model-selector">
    <label for="model-select">Model:</label>
    <select id="model-select">
      <option value="">Loading models...</option>
    </select>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
        }

        // Replace placeholders
        html = html.replace('{{cspSource}}', webviewView.webview.cspSource);
        html = html.replace(/{{nonce}}/g, nonce);
        html = html.replace('{{styleUri}}', styleUri.toString());
        html = html.replace('{{scriptUri}}', scriptUri.toString());

        webviewView.webview.html = html;
        
        // Store webview reference
        this.webviewView = webviewView;
        
        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
          console.log('[LMP] Sidebar received message:', message);
          if (message.command === 'webviewReady') {
            console.log('[LMP] Sidebar webview ready, fetching models...');
            try {
              const models = await this.provider.provideLanguageModelChatInformation(
                { silent: true },
                new vscode.CancellationTokenSource().token
              );
              const config = vscode.workspace.getConfiguration('local.model.provider');
              const defaultModel = config.get<string>('defaultModel', '');
              console.log('[LMP] Sending models to sidebar:', models.length, 'default:', defaultModel);
              webviewView.webview.postMessage({
                type: 'models',
                models: models,
                defaultModel: defaultModel
              });
            } catch (error) {
              console.error('[LMP] Failed to fetch models:', error);
            }
          } else if (message.command === 'sendMessage') {
            // Handle sendMessage directly - stream response back
            try {
              const targetModel = message.model || vscode.workspace.getConfiguration('local.model.provider').get<string>('defaultModel', '');
              if (!targetModel) {
                webviewView.webview.postMessage({ type: 'error', error: 'No model selected' });
                return;
              }

              console.log('[LMP] Streaming message to model:', targetModel);
              
              // Create cancellation token for this request
              this.currentCancellationSource = new vscode.CancellationTokenSource();
              const token = this.currentCancellationSource.token;
              
              let fullContent = '';
              let doneSent = false; // Track if we already sent the done message
              
              // Call streamMessage with correct parameter order: (text, modelId, onChunk, cancellationToken)
              await this.provider.streamMessage(message.text, targetModel, (chunk) => {
                if (chunk.content) {
                  fullContent += chunk.content;
                  webviewView.webview.postMessage({ type: 'assistant-chunk', content: chunk.content });
                }
                if (chunk.usage && !doneSent) {
                  // Send usage data when available
                  webviewView.webview.postMessage({ type: 'assistant-done', content: fullContent, usage: chunk.usage });
                  doneSent = true;
                  console.log('[LMP] Streaming complete, total length:', fullContent.length, 'usage:', chunk.usage);
                  // Clear cancellation source when done
                  this.currentCancellationSource = undefined;
                }
                if (chunk.cancelled) {
                  // Request was cancelled
                  webviewView.webview.postMessage({ type: 'request-stopped' });
                  console.log('[LMP] Streaming cancelled');
                  // Clear cancellation source
                  this.currentCancellationSource = undefined;
                }
                // If stream is done but no usage data (some models don't send usage)
                if (chunk.done && !chunk.usage && !chunk.cancelled && !doneSent) {
                  webviewView.webview.postMessage({ type: 'assistant-done', content: fullContent });
                  doneSent = true;
                  console.log('[LMP] Streaming complete (no usage data), total length:', fullContent.length);
                  this.currentCancellationSource = undefined;
                }
              }, token);
              
            } catch (error) {
              console.error('[LMP] Failed to send message:', error);
              webviewView.webview.postMessage({ 
                type: 'error', 
                error: error instanceof Error ? error.message : String(error) 
              });
              // Clear cancellation source on error
              this.currentCancellationSource = undefined;
            }
          } else if (message.command === 'stopRequest') {
            // Handle stop request - cancel the current streaming request
            console.log('[LMP] Stopping current request, source exists:', !!this.currentCancellationSource);
            if (this.currentCancellationSource) {
              this.currentCancellationSource.cancel();
              // Don't set to undefined here - let the callback handle it
              // this.currentCancellationSource = undefined;
              webviewView.webview.postMessage({ type: 'request-stopped' });
            }
          }
        });
        
        console.log('[LMP] Side-bar view loaded successfully');
      } catch (err) {
        console.error('[LMP] Failed to resolve side-bar view', err);
        webviewView.webview.html = `<html><body><h3>Failed to load view</h3></body></html>`;
      }
    }
  }

  // Register the side‑bar view provider (defined below the imports)
  const sideBarProvider = new ChatSideBarProvider(context.extensionUri, provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('localModelProvider.chat', sideBarProvider)
  );

  // Store reference to sideBarProvider for sending messages
  let sideBar: ChatSideBarProvider | undefined = sideBarProvider;

  // Helper to generate a nonce for CSP (same as in ChatWebview class)
  function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  // Get server URL for status bar
  const config = vscode.workspace.getConfiguration('local.model.provider');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:8000');
  statusBar.setStatus(ServerStatus.Unknown, { serverUrl });



  // Register command to set API key securely
  const setApiKeyCommand = vscode.commands.registerCommand(
    'local-model-provider.setApiKey',
    async () => {
      const secretManager = provider.getSecretManager();
      const hasExisting = await secretManager.hasApiKey();
      
      const placeholder = hasExisting 
        ? 'Enter new API key (leave empty to remove current key)'
        : 'Enter your API key for the inference server';

      const apiKey = await vscode.window.showInputBox({
        prompt: placeholder,
        password: true,
        placeHolder: 'sk-...',
        ignoreFocusOut: true,
      });

      if (apiKey === undefined) {
        return; // User cancelled
      }

      try {
        await secretManager.setApiKey(apiKey);
        // Apply the updated key to the running client immediately
        await provider.refreshApiKey();
        if (apiKey) {
          vscode.window.showInformationMessage(
            'Local Model Provider: API key stored securely.'
          );
        } else {
          vscode.window.showInformationMessage(
            'Local Model Provider: API key removed.'
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Local Model Provider: Failed to store API key. ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // Register command to show status menu
  const showStatusCommand = vscode.commands.registerCommand(
    'local-model-provider.showStatus',
    () => statusBar.showStatusMenu()
  );

  // Register command to view and select models
  const selectModelCommand = vscode.commands.registerCommand(
    'local-model-provider.selectModel',
    async () => {
      try {
        const models = await provider.provideLanguageModelChatInformation(
          { silent: false },
          new vscode.CancellationTokenSource().token
        );

        if (models.length === 0) {
          vscode.window.showWarningMessage('No models available.');
          return;
        }

        const currentDefault = vscode.workspace.getConfiguration('local.model.provider')
          .get<string>('defaultModel', '');

        const items: vscode.QuickPickItem[] = models.map((model) => ({
          label: model.id === currentDefault ? `$(star-full) ${model.name}` : `$(symbol-method) ${model.name}`,
          description: model.id === currentDefault ? 'Default' : '',
          detail: `Max Input: ${model.maxInputTokens} | Max Output: ${model.maxOutputTokens} | Tool Calling: ${model.capabilities?.toolCalling ? 'Yes' : 'No'}`,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a model (selecting sets as default)',
          title: `Available Models (${models.length})`,
        });

        if (selected) {
          const modelName = selected.label.replace(/^\$\([^)]+\)\s*/, '');
          await vscode.workspace.getConfiguration('local.model.provider')
            .update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
          
          // Immediately update status bar to reflect the change
          statusBar.setStatus(ServerStatus.Connected, { modelCount: models.length });
          
          vscode.window.showInformationMessage(`Default model set to: ${modelName}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register command to switch server presets
  const switchServerCommand = vscode.commands.registerCommand(
    'local-model-provider.switchServer',
    async () => {
      const config = vscode.workspace.getConfiguration('local.model.provider');
      const presets = config.get<ServerPreset[]>('serverPresets', []);
      
      // Get current URL from actual config (check both workspace and global)
      const currentUrl = config.get<string>('serverUrl', 'http://localhost:8000');
      
      // Log for debugging
      console.log('[Local Model Provider] Current server URL:', currentUrl);
      console.log('[Local Model Provider] Available presets:', presets.map(p => `${p.name}: ${p.url}`));

      const items: vscode.QuickPickItem[] = [
        {
          label: '$(add) Add New Preset',
          description: 'Create a new server preset',
          alwaysShow: true,
        },
      ];

      // Add delete option if there are presets
      if (presets.length > 0) {
        items.push({
          label: '$(trash) Delete Preset',
          description: 'Remove a saved preset',
          alwaysShow: true,
        });
      }

      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

      // Add current server if not in presets
      const currentInPresets = presets.some(p => p.url === currentUrl);
      if (!currentInPresets) {
        items.push({
          label: `$(check) Current: ${currentUrl}`,
          description: 'Active',
          detail: currentUrl,
        });
      }

      // Add presets
      for (const preset of presets) {
        items.push({
          label: preset.url === currentUrl ? `$(check) ${preset.name}` : `$(server) ${preset.name}`,
          description: preset.url === currentUrl ? 'Active' : '',
          detail: preset.url,
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a server preset',
        title: 'Server Presets',
      });

      if (!selected) {
        return;
      }

      if (selected.label.includes('Add New Preset')) {
        // Create new preset
        const name = await vscode.window.showInputBox({
          prompt: 'Enter preset name',
          placeHolder: 'e.g., Local vLLM, Ollama, Production',
        });

        if (!name) return;

        const url = await vscode.window.showInputBox({
          prompt: 'Enter server URL',
          placeHolder: 'http://localhost:8000',
          value: 'http://localhost:8000',
        });

        if (!url) return;

        const newPreset: ServerPreset = { name, url };
        const updatedPresets = [...presets, newPreset];

        await config.update('serverPresets', updatedPresets, vscode.ConfigurationTarget.Global);

        // Determine which configuration target to use for serverUrl
        const inspection = config.inspect<string>('serverUrl');
        let target = vscode.ConfigurationTarget.Global;
        
        if (inspection?.workspaceValue !== undefined) {
          target = vscode.ConfigurationTarget.Workspace;
        } else if (inspection?.workspaceFolderValue !== undefined) {
          target = vscode.ConfigurationTarget.WorkspaceFolder;
        }

        // Switch to new preset
        await config.update('serverUrl', url, target);
        // Ensure provider uses latest configuration immediately
        provider.applyLatestConfiguration();

        statusBar.setStatus(ServerStatus.Unknown, { serverUrl: url });
        provider.clearModelCache();
        
        // Refresh models from new server
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Switching server and refreshing models...',
            cancellable: false,
          },
          async () => {
            try {
              const models = await provider.provideLanguageModelChatInformation(
                { silent: false },
                new vscode.CancellationTokenSource().token
              );
              statusBar.setStatus(ServerStatus.Connected, { modelCount: models.length });
              if (models.length > 0) {
                vscode.window.showInformationMessage(
                  `Created and switched to: ${name}\nFound ${models.length} model(s)`
                );
              } else {
                vscode.window.showWarningMessage(
                  `Created and switched to: ${name}\nNo models found.`
                );
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              statusBar.setStatus(ServerStatus.Error, { errorMessage });
              vscode.window.showErrorMessage(`Created preset: ${name}\nFailed to fetch models: ${errorMessage}`);
            }
          }
        );
      } else if (selected.label.includes('Delete Preset')) {
        // Delete preset
        const deleteItems: vscode.QuickPickItem[] = presets.map(preset => ({
          label: `$(server) ${preset.name}`,
          description: preset.url === currentUrl ? 'Currently active' : '',
          detail: preset.url,
        }));

        const toDelete = await vscode.window.showQuickPick(deleteItems, {
          placeHolder: 'Select preset to delete',
          title: 'Delete Server Preset',
        });

        if (!toDelete) return;

        const presetName = toDelete.label.replace(/^\$\([^)]+\)\s*/, '');
        const confirmed = await vscode.window.showWarningMessage(
          `Delete preset "${presetName}"?`,
          { modal: true },
          'Delete'
        );

        if (confirmed === 'Delete') {
          const updatedPresets = presets.filter(p => p.name !== presetName);
          await vscode.workspace.getConfiguration('local.model.provider')
            .update('serverPresets', updatedPresets, vscode.ConfigurationTarget.Global);
          
          vscode.window.showInformationMessage(`Deleted preset: ${presetName}`);
        }
      } else if (selected.detail) {
        // Check if already on this server
        if (selected.detail === currentUrl) {
          vscode.window.showInformationMessage(`Already connected to: ${selected.detail}`);
          return;
        }

        // Switch to selected preset
        console.log('[Local Model Provider] Switching from', currentUrl, 'to', selected.detail);
        
        // Determine which configuration target to use
        const inspection = config.inspect<string>('serverUrl');
        let target = vscode.ConfigurationTarget.Global;
        
        if (inspection?.workspaceValue !== undefined) {
          target = vscode.ConfigurationTarget.Workspace;
        } else if (inspection?.workspaceFolderValue !== undefined) {
          target = vscode.ConfigurationTarget.WorkspaceFolder;
        }
        
        console.log('[Local Model Provider] Updating serverUrl at target:', target);
        
        await config.update('serverUrl', selected.detail, target);
        // Ensure provider uses latest configuration immediately
        provider.applyLatestConfiguration();
        
        // Verify the change
        const newUrl = vscode.workspace.getConfiguration('local.model.provider')
          .get<string>('serverUrl');
        console.log('[Local Model Provider] Server URL after update:', newUrl);

        statusBar.setStatus(ServerStatus.Unknown, { serverUrl: selected.detail });
        provider.clearModelCache();
        
        // Refresh models from new server
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Switching server and refreshing models...',
            cancellable: false,
          },
          async () => {
            try {
              const models = await provider.provideLanguageModelChatInformation(
                { silent: false },
                new vscode.CancellationTokenSource().token
              );
              statusBar.setStatus(ServerStatus.Connected, { modelCount: models.length });
              if (models.length > 0) {
                vscode.window.showInformationMessage(
                  `Switched to: ${selected.detail}\nFound ${models.length} model(s)`
                );
              } else {
                vscode.window.showWarningMessage(
                  `Switched to: ${selected.detail}\nNo models found.`
                );
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              statusBar.setStatus(ServerStatus.Error, { errorMessage });
              vscode.window.showErrorMessage(`Switched to: ${selected.detail}\nFailed to fetch models: ${errorMessage}`);
            }
          }
        );
      }
    }
  );

  // Register command to show statistics
  const showStatsCommand = vscode.commands.registerCommand(
    'local-model-provider.showStats',
    async () => {
      const stats = statsManager.getSessionStats();
      const modelStats = statsManager.getModelStats();

      let message = `📊 Session Statistics\n\n`;
      message += `• Total Requests: ${stats.totalRequests}\n`;
      message += `• Input Tokens: ${StatisticsManager.formatTokens(stats.totalInputTokens)}\n`;
      message += `• Output Tokens: ${StatisticsManager.formatTokens(stats.totalOutputTokens)}\n`;
      message += `• Average Response: ${StatisticsManager.formatDuration(stats.averageResponseTimeMs)}\n`;
      message += `• Last Response: ${StatisticsManager.formatDuration(stats.lastResponseTimeMs)}\n`;
      message += `• Session Started: ${stats.sessionStartTime.toLocaleTimeString()}\n`;

      if (modelStats.size > 0) {
        message += `\n📈 Per-Model Stats:\n`;
        for (const [modelId, mStats] of modelStats) {
          message += `\n${modelId}:\n`;
          message += `  • Requests: ${mStats.requests}\n`;
          message += `  • Input: ${StatisticsManager.formatTokens(mStats.inputTokens)}\n`;
          message += `  • Output: ${StatisticsManager.formatTokens(mStats.outputTokens)}\n`;
        }
      }

      const action = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        'Reset Statistics'
      );

      if (action === 'Reset Statistics') {
        statsManager.resetStats();
        vscode.window.showInformationMessage('Statistics reset.');
      }
    }
  );

  // Register command to refresh model cache
  const refreshModelsCommand = vscode.commands.registerCommand(
    'local-model-provider.refreshModels',
    async () => {
      provider.clearModelCache();
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Refreshing models...',
          cancellable: false,
        },
        async () => {
          try {
            const models = await provider.provideLanguageModelChatInformation(
              { silent: false },
              new vscode.CancellationTokenSource().token
            );
            statusBar.setStatus(ServerStatus.Connected, { modelCount: models.length });
            if (models.length > 0) {
              vscode.window.showInformationMessage(
                `Model cache refreshed. Found ${models.length} model(s): ${models.map(m => m.name).join(', ')}`
              );
            } else {
              vscode.window.showWarningMessage(
                'Model cache refreshed. No models found.'
              );
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            statusBar.setStatus(ServerStatus.Error, { errorMessage });
            vscode.window.showErrorMessage(`Failed to refresh models: ${errorMessage}`);
          }
        }
      );
    }
  );

  // Register command to show output channel
  const showOutputCommand = vscode.commands.registerCommand(
    'local-model-provider.showOutput',
    () => {
      provider.getOutputChannel().show();
    }
  );

  context.subscriptions.push(setApiKeyCommand);
  context.subscriptions.push(showStatusCommand);
  context.subscriptions.push(selectModelCommand);
  context.subscriptions.push(switchServerCommand);
  context.subscriptions.push(showStatsCommand);
  context.subscriptions.push(refreshModelsCommand);
  context.subscriptions.push(showOutputCommand);

  // Watch for config changes to update status bar
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('local.model.provider.serverUrl')) {
        const newConfig = vscode.workspace.getConfiguration('local.model.provider');
        const newServerUrl = newConfig.get<string>('serverUrl', 'http://localhost:8000');
        statusBar.setStatus(ServerStatus.Unknown, { serverUrl: newServerUrl });
      }
      
      // Clear model cache when defaultModel changes to force VS Code to refresh
      if (e.affectsConfiguration('local.model.provider.defaultModel')) {
        provider.clearModelCache();
      }
    })
  );

  console.log('Local Model Provider registered with vendor ID: local-model-provider');
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log('Local Model Provider extension is now deactivated');
}

