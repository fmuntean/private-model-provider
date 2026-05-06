# Configuration Guide

This extension is highly configurable through VS Code settings and the secret storage API.

## Settings (contributes.configuration)
Add the following entries to your `settings.json` (or use the UI Settings editor).

| Setting | Type | Description | Default |
|---------|------|-------------|---------|
| `localModelProvider.endpoint` | `string` | Base URL of the LLM API (e.g., `https://api.openai.com/v1/chat/completions`). | `""` |
| `localModelProvider.model` | `string` | Model identifier to request from the endpoint. | `"gpt-4o"` |
| `localModelProvider.temperature` | `number` | Sampling temperature (0‑2). | `0.7` |
| `localModelProvider.maxTokens` | `number` | Maximum tokens for the assistant response. | `1024` |
| `localModelProvider.systemPrompt` | `string` | Default system prompt that is prepended to every conversation. | `"You are a helpful assistant."` |
| `localModelProvider.showTokenStats` | `boolean` | Show token usage badge in the status bar. | `true` |
| `localModelProvider.enableTelemetry` | `boolean` | Send anonymous usage telemetry (opt‑in). | `false` |

## Secret Storage
The API key is **not** stored in `settings.json`. It is saved securely via VS Code's `SecretStorage` API.

```ts
// secrets.ts (excerpt)
export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    return await context.secrets.get('localModelProvider.apiKey');
}

export async function setApiKey(context: vscode.ExtensionContext, key: string) {
    await context.secrets.store('localModelProvider.apiKey', key);
}
```

### Setting the API Key
1. Open the command palette (`Ctrl+Shift+P`).
2. Run **Local Model Provider: Set API Key** (a command you will add in `extension.ts`).
3. Enter the key – it will be stored securely.

## Example `settings.json`
```json
{
    "localModelProvider.endpoint": "https://api.openai.com/v1/chat/completions",
    "localModelProvider.model": "gpt-4o-mini",
    "localModelProvider.temperature": 0.6,
    "localModelProvider.maxTokens": 800,
    "localModelProvider.systemPrompt": "You are a helpful coding assistant.",
    "localModelProvider.showTokenStats": true,
    "localModelProvider.enableTelemetry": false
}
```

---
*All settings are read at runtime; changes take effect after reopening the chat panel.*