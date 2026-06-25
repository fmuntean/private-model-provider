import * as vscode from 'vscode';
import * as fs from 'fs';
import { GatewayProvider } from '../provider';
import { SessionManager } from '../sessionManager';
import { getLogger, Logger } from '../vscodeLogger';

/**
 * Webview provider for the chat sidebar
 */
export class ChatSideBarProvider implements vscode.WebviewViewProvider {
    private webviewView: vscode.WebviewView | undefined;
    private logger: Logger;
    private currentSelectedModelId: string | null = null;

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
  <title>Private Model Chat</title>
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
                            this.sendModels();
                            this.sendSessions();
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
                                var session = this.sessionManager.getActiveSession()
                                //this.sendSessions(); // Refresh session list
                                this.webviewView?.webview.postMessage({
                                        type: 'showChat',
                                        session: session
                                });
                                // Also update the current selected model ID to match the session's model
                                if (session) {
                                    this.currentSelectedModelId = session.modelId;
                                    this.logger.info(`[LMP] Updated current model to session's model: ${session.modelId}`);
                                }
                            }
                            break;
                            
                        case 'sendMessage':
                            // Send message to the model
                            if (!message.sessionId){
                                // Get the default model from configuration if no model is selected
                                let modelId = message.model;
                                if (!modelId) {
                                    const config = vscode.workspace.getConfiguration('private.model.provider');
                                    modelId = config.get<string>('defaultModel', 'default');
                                }
                                //create a new session
                                let session = this.sessionManager.createSession(modelId);
                                message.sessionId = session.id;
                                //create session title
                                this.provider.generateSessionTitle(message.text,session.id).then((title)=>{
                                    session.title = title;
                                    this.webviewView?.webview.postMessage({
                                        type: 'showChat',
                                        session: session
                                    });
                                })
                            }
                            // Track the current selected model
                            this.currentSelectedModelId = message.model; 
                            
                            this.webviewView?.webview.postMessage({
                                type: 'user',
                                content: message.text,
                                sessionId: message.sessionId
                            });
                            
                            this.logger.info(`[LMP] Send message: ${message.text}`);
                            try {
                                // Use streaming API to send incremental chunks to the webview
                                await this.provider.streamMessage(
                                    message.text,
                                    message.model,
                                    async (chunk) => {
                                        // Forward each chunk to the webview as it arrives
                                        if (!this.webviewView) return;
                                        // Handle tool call events specially
                                        if (chunk.type === 'toolCall') {
                                            this.webviewView.webview.postMessage({
                                                type: 'toolCall',
                                                name: chunk.name,
                                                arguments: chunk.arguments,
                                                toolCallId: chunk.id,
                                                sessionId: message.sessionId
                                            });
                                            return;
                                        }
                                        if (chunk.type === 'reasoning') {
                                            this.webviewView.webview.postMessage({
                                                type: 'reasoningChunk',
                                                content: chunk.content,
                                                sessionId: message.sessionId
                                            });
                                            return;
                                        }
                                        if (chunk.content) {
                                            this.webviewView.webview.postMessage({
                                                type: 'messageChunk',
                                                content: chunk.content,
                                                sessionId: message.sessionId
                                            });
                                        }
                                        if (chunk.done) {
                                            this.webviewView.webview.postMessage({
                                                type: 'messageDone',
                                                usage: chunk.usage,
                                                cancelled: !!chunk.cancelled,
                                                sessionId: message.sessionId
                                            });
                                        }
                                    },
                                    undefined,
                                    message.sessionId
                                );
                                this.logger.info(`[LMP] Streamed message completed`);
                            } catch (error) {
                                this.logger.error('[LMP] Failed to stream message:', error);
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
                            
                        case 'modelSelected':
                            // Track when user changes model selection
                            this.currentSelectedModelId = message.model;
                            this.logger.info(`[LMP] Model selection changed to: ${message.model}`);
                            break;
                        // Tool results are now handled automatically by the provider; no UI round‑trip needed.
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
     * Get the currently selected model ID from the chat view
     */
    public getCurrentSelectedModelId(): string | null {
        return this.currentSelectedModelId;
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
            
            const config = vscode.workspace.getConfiguration('private.model.provider');
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
    
    /**
     * Public method to trigger a refresh of the model list sent to the webview.
     * This is used by the extension command that refreshes the model cache so
     * the dropdown in the chat UI reflects the newly fetched models.
     */
    public async refreshModels(): Promise<void> {
        await this.sendModels();
    }


    
    /**
     * Dispose resources when the extension is deactivated.
     * This satisfies the vscode.Disposable contract required when the provider
     * is added to `context.subscriptions`.
     */
    public dispose(): void {
        // Currently there are no long‑lived resources to clean up.
        // The logger is shared; we simply log disposal for debugging.
        this.logger.info('ChatSideBarProvider disposed');
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

