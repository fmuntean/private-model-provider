import * as vscode from 'vscode';
import { GatewayProvider } from './provider';
import { StatusBarManager, ServerStatus, ServerPreset } from './statusBar';
import { getLogger } from './vscodeLogger';
import { StatisticsManager } from './statistics';
import { ChatSideBarProvider } from './ui/chatView';
import * as fs from 'fs';
import { PromptManager } from './prompts';
import { LlmClient } from './llmClient';

/**
 * Implements the "private-model-provider.selectMcpTools" command.
 */
export async function selectMcpTools(provider: GatewayProvider): Promise<void> {
  // Access the MCP manager attached to the provider (may be undefined if MCP is not configured)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mcpMgr: any = (provider as any)['mcpManager'];
  if (!mcpMgr || typeof mcpMgr.getToolDefinitions !== 'function') {
    vscode.window.showWarningMessage('MCP manager not available - no tools to select');
    return;
  }

  const allTools = mcpMgr.getToolDefinitions();
  const toolNames = allTools.map((t: any) => t.function?.name ?? t.name);
  const config = vscode.workspace.getConfiguration('private.model.provider');
  const enabled: string[] = config.get<string[]>('enabledMcpTools', []);

  const items: vscode.QuickPickItem[] = toolNames.map((name: string) => ({
    label: name,
    picked: enabled.includes(name),
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select MCP tools to enable for tool calling',
  });

  if (!selected) {
    return; // user cancelled
  }

  const newEnabled = selected.map((s) => s.label);
  await config.update('enabledMcpTools', newEnabled, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage('MCP tool selection updated');
}

/**
 * Implements the "private-model-provider.setApiKey" command.
 * Extracted from extension.ts to keep command registration separate.
 */
export async function setApiKey(provider: GatewayProvider): Promise<void> {
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
        'Private Model Provider: API key stored securely.'
      );
    } else {
      vscode.window.showInformationMessage(
        'Private Model Provider: API key removed.'
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Private Model Provider: Failed to store API key. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}


/**
 * Implements the "private-model-provider.selectModel" command.
 * Extracted from extension.ts to keep command registration separate.
 */
export async function selectModel(
  provider: GatewayProvider,
  statusBar: StatusBarManager
): Promise<void> {
  try {
    const models = await provider.provideLanguageModelChatInformation(
      { silent: false },
      new vscode.CancellationTokenSource().token
    );

    if (models.length === 0) {
      vscode.window.showWarningMessage('No models available.');
      return;
    }

    const currentDefault = vscode.workspace
      .getConfiguration('private.model.provider')
      .get<string>('defaultModel', '');

    const items: vscode.QuickPickItem[] = models.map((model) => ({
      label:
        model.id === currentDefault
          ? `$(star-full) ${model.name}`
          : `$(symbol-method) ${model.name}`,
      description: model.id === currentDefault ? 'Default' : '',
      detail: `Max Input: ${model.maxInputTokens} | Max Output: ${model.maxOutputTokens} | Tool Calling: ${model.capabilities?.toolCalling ? 'Yes' : 'No'}`,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a model (selecting sets as default)',
      title: `Available Models (${models.length})`,
    });

    if (selected) {
      const modelName = selected.label.replace(/^\$\([^)]*\)\s*/, '');
      await vscode.workspace
        .getConfiguration('private.model.provider')
        .update('defaultModel', modelName, vscode.ConfigurationTarget.Global);

      // Immediately update status bar to reflect the change
      statusBar.setStatus(ServerStatus.Connected, { modelCount: models.length });

      vscode.window.showInformationMessage(`Default model set to: ${modelName}`);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Implements the "private-model-provider.switchServer" command.
 * Extracted from extension.ts to keep command registration separate.
 */
export async function switchServer(
  provider: GatewayProvider,
  statusBar: StatusBarManager
): Promise<void> {
  const logger = getLogger();
  const config = vscode.workspace.getConfiguration('private.model.provider');
  const presets = config.get<ServerPreset[]>('serverPresets', []);

  // Get current URL from actual config (check both workspace and global)
  const currentUrl = config.get<string>('serverUrl', 'http://localhost:8000');

  // Log for debugging
  logger.info(`[Private Model Provider] Current server URL: ${currentUrl}`);
  logger.info(
    `[Private Model Provider] Available presets: ${presets.map(
      (p) => `${p.name}: ${p.url}`
    )}`
  );

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
  const currentInPresets = presets.some((p) => p.url === currentUrl);
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
          vscode.window.showErrorMessage(
            `Created preset: ${name}\nFailed to fetch models: ${errorMessage}`
          );
        }
      }
    );
  } else if (selected.label.includes('Delete Preset')) {
    // Delete preset
    const deleteItems: vscode.QuickPickItem[] = presets.map((preset) => ({
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
      const updatedPresets = presets.filter((p) => p.name !== presetName);
      await vscode.workspace
        .getConfiguration('private.model.provider')
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
    logger.info(
      `[Private Model Provider] Switching from ${currentUrl} to ${selected.detail}`
    );

    // Determine which configuration target to use
    const inspection = config.inspect<string>('serverUrl');
    let target = vscode.ConfigurationTarget.Global;
    if (inspection?.workspaceValue !== undefined) {
      target = vscode.ConfigurationTarget.Workspace;
    } else if (inspection?.workspaceFolderValue !== undefined) {
      target = vscode.ConfigurationTarget.WorkspaceFolder;
    }

    logger.info(`[Private Model Provider] Updating serverUrl at target: ${target}`);

    await config.update('serverUrl', selected.detail, target);
    // Ensure provider uses latest configuration immediately
    provider.applyLatestConfiguration();

    // Verify the change
    const newUrl = vscode.workspace
      .getConfiguration('private.model.provider')
      .get<string>('serverUrl');
    logger.info(`[Private Model Provider] Server URL after update: ${newUrl}`);

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
          vscode.window.showErrorMessage(
            `Switched to: ${selected.detail}\nFailed to fetch models: ${errorMessage}`
          );
        }
      }
    );
  }
}

/**
 * 
 * @param statsManager 
 */
export async function showStats(statsManager: StatisticsManager): Promise<void> {
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

/**
 * 
 * @param chatViewProviderRef 
 * @param provider 
 * @param statusBar 
 */
export async function refreshModels(chatViewProviderRef: { current: ChatSideBarProvider }, provider: GatewayProvider, statusBar: StatusBarManager): Promise<void>{
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Refreshing models...',
      cancellable: false,
    },
    async () => {
      try {
        const models = await provider.refreshModels();
        // Update status bar with new model count
        statusBar.setStatus(ServerStatus.Connected, { modelCount: models.length });
        // Notify the chat view UI to refresh its model dropdown
        if (chatViewProviderRef && chatViewProviderRef.current && typeof chatViewProviderRef.current.refreshModels === 'function') {
          chatViewProviderRef.current.refreshModels();
        }
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

/**
 * 
 * @param provider 
 */
export async function testConnection(provider: GatewayProvider): Promise<void> {
  try {
    // Ensure we fetch fresh model information, bypassing any cached list
    provider.clearModelCache();
    // Attempt a silent fetch of models to verify connectivity
    await provider.provideLanguageModelChatInformation(
      { silent: true },
      new vscode.CancellationTokenSource().token
    );
    vscode.window.showInformationMessage('Private Model Provider: Connection successful');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(`Private Model Provider: Connection failed - ${msg}`);
  }
}

/**
 * Implements the "private-model-provider.generateSystemPrompts" command.
 * Extracted from extension.ts to keep command registration separate.
 */
export async function generateSystemPrompts(
  context: vscode.ExtensionContext,
  provider: GatewayProvider,
  chatViewProviderRef: { current: ChatSideBarProvider }
): Promise<void> {
  try {
    const logger = getLogger();

    // Retrieve models
    const models = await provider.provideLanguageModelChatInformation(
      { silent: false },
      new vscode.CancellationTokenSource().token
    );

    if (models.length === 0) {
      vscode.window.showErrorMessage(
        'No models available. Please connect to a server first.'
      );
      return;
    }

    const config = vscode.workspace.getConfiguration('private.model.provider');
    const currentDefault = config.get<string>('defaultModel', '');
    // The defaultModel configuration stores the model's display name (as set in the dropdown),
    // not the internal model ID. Match by name to respect the user's selection.
    const fallbackModel = models.find((m) => m.name === currentDefault) || models[0];

    // Get the currently selected model from the chat view UI
    const chatViewProvider = chatViewProviderRef.current as any;
    let selectedModel = fallbackModel;

    if (chatViewProvider && chatViewProvider.getCurrentSelectedModelId) {
      const currentSelectedModelId = chatViewProvider.getCurrentSelectedModelId();
      if (currentSelectedModelId) {
        selectedModel =
          models.find((m) => m.id === currentSelectedModelId) || fallbackModel;
      }
    }

    logger.info(
      `[Private Model Provider] Generating prompts for model: ${selectedModel.name} (${selectedModel.id})`
    );

    // Use PromptManager for paths and templates
    const promptManager = new PromptManager(context);
    const modelId = selectedModel.id;
    const folderPath = promptManager.getModelPromptFolderPath(modelId);
    const systemPath = promptManager.getModelPromptFilePath(modelId, 'system');
    const titlePath = promptManager.getModelPromptFilePath(modelId, 'title');

    // Check for existing prompts
    if (fs.existsSync(systemPath) || fs.existsSync(titlePath)) {
      const overwrite = await vscode.window.showWarningMessage(
        'Optimized prompts already exist for this model. Do you want to overwrite them?',
        { modal: true },
        'Overwrite'
      );
      if (overwrite !== 'Overwrite') {
        return;
      }
    }

    // Ensure folder exists
    promptManager.ensureModelPromptFolder(modelId);

    // Read base templates via PromptManager
    const systemTemplate = promptManager.readBasePromptTemplate('system');
    const titleTemplate = promptManager.readBasePromptTemplate('title');

    // Optimize using PromptManager's LLM helper
    const client = (provider as any).client as LlmClient;
    const optimizedSystem = await promptManager.optimizePromptWithLLM(
      client,
      systemTemplate,
      selectedModel,
      'system'
    );
    const optimizedTitle = await promptManager.optimizePromptWithLLM(
      client,
      titleTemplate,
      selectedModel,
      'title'
    );

    // Save prompts
    promptManager.saveModelPromptFile(modelId, 'system', optimizedSystem);
    promptManager.saveModelPromptFile(modelId, 'title', optimizedTitle);

    vscode.window.showInformationMessage(
      `Optimized prompts saved for model ${selectedModel.name} in ${folderPath}`
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Failed to generate system prompts: ${errorMessage}`
    );
    const logger = getLogger();
    logger.error(
      `[Private Model Provider] Failed to generate prompts: ${errorMessage}`
    );
  }
}


export async function startMcpServers(provider: GatewayProvider): Promise<void> {
  try {
    // Access the private mcpManager via bracket notation to avoid TS errors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcpMgr: any = (provider as any)['mcpManager'];
    if (mcpMgr && typeof mcpMgr.startAll === 'function') {
      await mcpMgr.startAll();
      vscode.window.showInformationMessage('MCP servers started');
    } else {
      vscode.window.showWarningMessage('MCP manager not available');
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to start MCP servers: ${e instanceof Error ? e.message : String(e)}`);
  }
}


export async function stopMcpServers(provider:GatewayProvider): Promise<void> {
  try {
    const mcpMgr: any = (provider as any)['mcpManager'];
    if (mcpMgr && typeof mcpMgr.stopAll === 'function') {
      await mcpMgr.stopAll();
      vscode.window.showInformationMessage('MCP servers stopped');
    } else {
      vscode.window.showWarningMessage('MCP manager not available');
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to stop MCP servers: ${e instanceof Error ? e.message : String(e)}`);
  }
}