import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import { ChatSessionMetadata } from '../types';
import { PromptManager } from '../prompts';

/**
 * Session list item for display in the tree view
 */
class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly session: ChatSessionMetadata,
    public readonly isActive: boolean
  ) {
    super(
      session.title || 'New Chat',
      vscode.TreeItemCollapsibleState.None
    );

    this.tooltip = `${session.title}\nModel: ${session.modelId}\nMessages: ${session.messageCount}\nUpdated: ${new Date(session.updatedAt).toLocaleString()}`;
    this.description = `${session.messageCount} msgs | ${this.formatTokens(session.tokenUsage.total.totalTokens)}`;
    
    // Highlight active session
    if (isActive) {
      this.iconPath = new vscode.ThemeIcon('check');
      this.label = `$(check) ${this.label}`;
    } else {
      this.iconPath = new vscode.ThemeIcon('comment');
    }

    this.contextValue = 'session';
    this.command = {
      command: 'private-model-provider.switchSession',
      title: 'Switch to Session',
      arguments: [session.id]
    };
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  }
}

/**
 * Tree data provider for chat sessions sidebar
 */
export class SessionViewProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly sessionManager: SessionManager) {
    // Refresh tree when sessions change
    sessionManager.onDidChangeSession(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem): Thenable<SessionTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const sessions = this.sessionManager.getAllSessions();
    const activeSession = this.sessionManager.getActiveSession();

    const items = sessions.map(session => 
      new SessionTreeItem(session, activeSession?.id === session.id)
    );

    return Promise.resolve(items);
  }

  /**
   * Get the active session item for external use
   */
  getActiveSession(): ChatSessionMetadata | null {
    return this.sessionManager.getActiveSession();
  }
}

/**
 * Register session view and commands
 */
export function registerSessionView(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager
): SessionViewProvider {
  const sessionViewProvider = new SessionViewProvider(sessionManager);

  // Register commands
  const commands = [
    vscode.commands.registerCommand('private-model-provider.createSession', async () => {
      const session = sessionManager.createSession();
      sessionViewProvider.refresh();
      vscode.window.showInformationMessage(`Created new session: ${session.title}`);
      // Notify extension to update webview
      vscode.commands.executeCommand('localModelProvider.getSessions');
    }),

    vscode.commands.registerCommand('private-model-provider.switchSession', async (sessionId: string) => {
      sessionManager.switchSession(sessionId);
      sessionViewProvider.refresh();
      // Notify extension to update webview
      vscode.commands.executeCommand('localModelProvider.getSessions');
    }),

    vscode.commands.registerCommand('private-model-provider.deleteSession', async (item?: SessionTreeItem) => {
      let sessionId: string | undefined = item?.session.id;
      
      if (!sessionId) {
        // If no item provided, ask user to select
        const sessions = sessionManager.getAllSessions();
        if (sessions.length === 0) {
          vscode.window.showInformationMessage('No sessions to delete');
          return;
        }
        const selected = await vscode.window.showQuickPick(
          sessions.map(s => ({ label: s.title, description: s.id })),
          { placeHolder: 'Select session to delete' }
        );
        if (!selected) return;
        sessionId = selected.description;
      }

      const confirmed = await vscode.window.showWarningMessage(
        'Delete this session? This action cannot be undone.',
        'Delete',
        'Cancel'
      );
      
      if (confirmed === 'Delete' && sessionId) {
        sessionManager.deleteSession(sessionId);
        sessionViewProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('private-model-provider.renameSession', async (item?: SessionTreeItem) => {
      let sessionId: string | undefined = item?.session.id;
      
      if (!sessionId) {
        const sessions = sessionManager.getAllSessions();
        const selected = await vscode.window.showQuickPick(
          sessions.map(s => ({ label: s.title, description: s.id })),
          { placeHolder: 'Select session to rename' }
        );
        if (!selected) return;
        sessionId = selected.description;
      }

      if (!sessionId) return;

      const session = sessionManager.getActiveSession();
      if (!session || session.id !== sessionId) {
        vscode.window.showErrorMessage('Can only rename the active session');
        return;
      }

      const newTitle = await vscode.window.showInputBox({
        prompt: 'Enter new session title',
        value: session.title,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Title cannot be empty';
          }
          return null;
        }
      });

      if (newTitle) {
        sessionManager.updateSessionTitle(sessionId, newTitle);
        sessionViewProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('private-model-provider.editMasterPrompt', async () => {
      const promptManager = new PromptManager(context);
      const masterPrompt = promptManager.getMasterPrompt() || '';
      
      const result = await vscode.window.showInputBox({
        prompt: 'Edit master prompt (saved to .llm/master.md)',
        value: masterPrompt,
        validateInput: (value) => null
      });

      if (result !== undefined) {
        try {
          promptManager.saveMasterPrompt(result);
          vscode.window.showInformationMessage('Master prompt saved to .llm/master.md');
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to save master prompt: ${error}`);
        }
      }
    })
  ];

  commands.forEach(cmd => context.subscriptions.push(cmd));

  return sessionViewProvider;
}
