import * as vscode from 'vscode';
import * as fs from 'fs';
import { GatewayProvider } from '../provider';
import { SessionManager } from '../sessionManager';
import { getLogger, Logger } from '../logger';

/**
 * Webview provider for the chat sidebar
 */
export class ChatSideBarProvider implements vscode.WebviewViewProvider {
    private webviewView: vscode.WebviewView | undefined;
    private logger: Logger;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly provider: GatewayProvider,
        private readonly sessionManager: SessionManager
    ) {
        this.logger = getLogger();
    }

    /** Resolve the webview view when the side‑bar panel is shown */
    public async resolveWebviewView(webviewView: vscode.WebviewView) {
        try {
            this.webviewView = webviewView;
            
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
                html = fs.readFileSync(htmlPath, 'utf-8');
            } catch (e) {
                this.logger.error('[LMP] Failed to read index.html:', e);
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
  <div>Could not load View</div>
</body>
</html>`;
            }

            // Replace placeholders
            html = html.replace('{{cspSource}}', webviewView.webview.cspSource);
            html = html.replace(/{{nonce}}/g, nonce);
            html = html.replace('{{styleUri}}', styleUri.toString());
            html = html.replace('{{scriptUri}}', scriptUri.toString());

            webviewView.webview.html = html;
            
            // Handle messages from the webview
            webviewView.webview.onDidReceiveMessage(
                async (message) => {
                    this.logger.info(`[LMP] Received message from webview: ${message.command}`);
                    
                    switch (message.command) {
                        case 'webviewReady':
                            // Webview is ready, send initial data
                            this.sendSessions();
                            this.sendModels();
                            break;
                            
                        case 'requestSessions':
                            this.sendSessions();
                            break;
                            
                        case 'requestModels':
                            this.sendModels();
                            break;
                            
                        case 'switchSession':
                            if (message.sessionId) {
                                this.sessionManager.switchSession(message.sessionId);
                                this.sendSessions(); // Refresh session list
                            }
                            break;
                            
                        case 'sendMessage':
                            // Send message to the model
                            this.logger.info(`[LMP] Send message: ${message.text}`);
                            try {
                                const result = await this.provider.sendMessage(
                                    message.text,
                                    message.model,
                                    message.sessionId
                                );
                                this.logger.info(`[LMP] Message sent successfully`);
                                // Send the response back to the webview
                                if (this.webviewView) {
                                    this.webviewView.webview.postMessage({
                                        type: 'messageResponse',
                                        content: result.content,
                                        usage: result.usage
                                    });
                                }
                            } catch (error) {
                                this.logger.error('[LMP] Failed to send message:', error);
                                if (this.webviewView) {
                                    this.webviewView.webview.postMessage({
                                        type: 'messageError',
                                        error: error instanceof Error ? error.message : String(error)
                                    });
                                }
                            }
                            break;
                            
                        case 'stopRequest':
                            // TODO: Handle stopping generation
                            this.logger.info('[LMP] Stop request received');
                            break;
                            
                        case 'log':
                            // Log message from webview
                            this.logger.info(`[Webview] ${message.message}`);
                            break;
                    }
                },
                undefined,
                []
            );
            
            this.logger.info('[LMP] Side-bar view loaded successfully');
        } catch (err) {
            this.logger.error('[LMP] Failed to resolve side-bar view', err);
        }
    }
    
    /**
     * Send sessions to the webview
     */
    private sendSessions(): void {
        if (!this.webviewView) return;
        
        const sessions = this.sessionManager.getAllSessions();
        const activeSession = this.sessionManager.getActiveSession();
        
        this.webviewView.webview.postMessage({
            type: 'sessions',
            sessions: sessions,
            activeSessionId: activeSession?.id || null
        });
        
        this.logger.info(`[LMP] Sent ${sessions.length} sessions to webview`);
    }
    
    /**
     * Send available models to the webview
     */
    private async sendModels(): Promise<void> {
        if (!this.webviewView) return;
        
        try {
            const models = await this.provider.provideLanguageModelChatInformation(
                { silent: true },
                new vscode.CancellationTokenSource().token
            );
            
            const config = vscode.workspace.getConfiguration('local.model.provider');
            const defaultModel = config.get<string>('defaultModel', '');
            
            this.webviewView.webview.postMessage({
                type: 'models',
                models: models,
                defaultModel: defaultModel
            });
            
            this.logger.info(`[LMP] Sent ${models.length} models to webview`);
        } catch (error) {
            this.logger.error('[LMP] Failed to get models:', error);
            this.webviewView.webview.postMessage({
                type: 'models',
                models: [],
                defaultModel: ''
            });
        }
    }
}

// Helper to generate a nonce for CSP
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Register the chat sidebar webview provider
 */
export function registerChatView(
    context: vscode.ExtensionContext,
    provider: GatewayProvider,
    sessionManager: SessionManager
): ChatSideBarProvider {
    const chatViewProvider = new ChatSideBarProvider(context.extensionUri, provider, sessionManager);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('localModelProvider.chat', chatViewProvider)
    );

    return chatViewProvider;
}

