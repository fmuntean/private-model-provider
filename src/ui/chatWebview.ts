import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GatewayProvider } from '../provider';

export class ChatWebview {
    public static readonly viewType = 'localModelProvider.chat';
    private panel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];
    private provider: GatewayProvider | undefined;

    constructor(private readonly context: vscode.ExtensionContext, provider?: GatewayProvider) {
        this.provider = provider;
    }

    /**
     * Set or update the provider reference (useful when provider is created after ChatWebview)
     */
    public setProvider(provider: GatewayProvider): void {
        this.provider = provider;
    }

    public show() {
        console.log('[LMP] show() called');
        if (this.panel) {
            console.log('[LMP] Panel exists, revealing...');
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        console.log('[LMP] Creating webview panel...');
        this.panel = vscode.window.createWebviewPanel(
            ChatWebview.viewType,
            'Local Model Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'ui', 'assets'))]
            }
        );
        console.log('[LMP] Setting webview HTML...');
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        console.log('[LMP] Registering message handler...');
        this.panel.webview.onDidReceiveMessage((message) => {
            console.log('[LMP] Message received in arrow function:', message);
            this.handleMessage(message);
        }, null, this.disposables);
        console.log('[LMP] Message handler registered.');
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'ui', 'assets', 'main.js')));
        const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'src', 'ui', 'assets', 'style.css')));
        const nonce = getNonce();

        // Load HTML from file and replace placeholders
        const htmlPath = path.join(this.context.extensionPath, 'src', 'ui', 'assets', 'index.html');
        let html: string;
        try {
            console.log('[LMP] Reading HTML from:', htmlPath);
            html = fs.readFileSync(htmlPath, 'utf-8');
            console.log('[LMP] HTML loaded, length:', html.length);
            console.log('[LMP] HTML contains model-selector:', html.includes('model-selector'));
            console.log('[LMP] HTML contains scriptUri:', html.includes('{{scriptUri}}'));
        } catch (e) {
            console.error('[LMP] Failed to read HTML file:', e);
            // Fallback to embedded HTML if file can't be read
            html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
            return html;
        }

        // Replace placeholders in the HTML
        console.log('[LMP] Replacing placeholders...');
        const beforeCsp = html.includes('{{cspSource}}');
        html = html.replace('{{cspSource}}', webview.cspSource);
        const afterCsp = html.includes('{{cspSource}}');
        console.log('[LMP] cspSource replaced:', beforeCsp, '->', afterCsp);
        
        const beforeNonce = html.includes('{{nonce}}');
        html = html.replace(/{{nonce}}/g, nonce);
        const afterNonce = html.includes('{{nonce}}');
        console.log('[LMP] nonce replaced:', beforeNonce, '->', afterNonce);
        
        const beforeStyle = html.includes('{{styleUri}}');
        html = html.replace('{{styleUri}}', styleUri.toString());
        const afterStyle = html.includes('{{styleUri}}');
        console.log('[LMP] styleUri replaced:', beforeStyle, '->', afterStyle);
        
        const beforeScript = html.includes('{{scriptUri}}');
        html = html.replace('{{scriptUri}}', scriptUri.toString());
        const afterScript = html.includes('{{scriptUri}}');
        console.log('[LMP] scriptUri replaced:', beforeScript, '->', afterScript);
        
        console.log('[LMP] HTML ready, length:', html.length);
        console.log('[LMP] HTML contains model-selector:', html.includes('model-selector'));
        console.log('[LMP] HTML contains scriptUri:', html.includes('{{scriptUri}}'));

        return html;
    }

    private async handleMessage(message: any) {
        console.log('[LMP] ChatWebview received message:', message);
        switch (message.command) {
            case 'webviewReady':
                console.log('[LMP] Webview is ready, requesting models...');
                // Request models now that webview is ready
                if (this.provider) {
                    try {
                        console.log('[LMP] Fetching models from provider...');
                        const models = await this.provider.provideLanguageModelChatInformation(
                            { silent: true },
                            new vscode.CancellationTokenSource().token
                        );
                        const config = vscode.workspace.getConfiguration('local.model.provider');
                        const defaultModel = config.get<string>('defaultModel', '');
                        console.log('[LMP] Sending models to webview:', models.length, 'default:', defaultModel);
                        this.panel?.webview.postMessage({
                            type: 'models',
                            models: models,
                            defaultModel: defaultModel
                        });
                    } catch (error) {
                        console.error('[LMP] Failed to fetch models:', error);
                    }
                }
                break;
            case 'sendMessage':
                // Forward to the provider (implemented in extension.ts)
                // Include the selected model if provided
                vscode.commands.executeCommand('localModelProvider.sendMessage', message.text, message.model);
                break;
            case 'requestModels':
                console.log('[LMP] Handling requestModels...');
                // Fetch models from the provider and send back to webview
                if (this.provider) {
                    try {
                        console.log('[LMP] Fetching models from provider...');
                        const models = await this.provider.provideLanguageModelChatInformation(
                            { silent: true },
                            new vscode.CancellationTokenSource().token
                        );
                        console.log('[LMP] Models received:', models);
                        const config = vscode.workspace.getConfiguration('local.model.provider');
                        const defaultModel = config.get<string>('defaultModel', '');
                        console.log('[LMP] Sending models to webview:', models.length, 'default:', defaultModel);
                        this.panel?.webview.postMessage({
                            type: 'models',
                            models: models,
                            defaultModel: defaultModel
                        });
                    } catch (error) {
                        console.error('[LMP] Failed to fetch models:', error);
                        this.panel?.webview.postMessage({
                            type: 'models',
                            models: [],
                            defaultModel: ''
                        });
                    }
                } else {
                    console.error('[LMP] Provider not set!');
                }
                break;
            case 'requestStats':
                vscode.commands.executeCommand('localModelProvider.getStats');
                break;
        }
    }

    public postMessage(data: any) {
        this.panel?.webview.postMessage(data);
    }

    public dispose() {
        this.panel?.dispose();
        this.panel = undefined;
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
