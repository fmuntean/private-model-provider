# Configuration Guide

This extension is highly configurable through VS Code settings and the secret storage API.

## Settings (contributes.configuration)
Add the following entries to your `settings.json` (or use the UI Settings editor).

| Setting | Type | Description | Default |
|---------|------|-------------|---------|
| `private.model.provider.serverUrl` | `string` | Inference server URL (OpenAI API compatible endpoint) | `http://localhost:8000` |
| `private.model.provider.serverPresets` | `array` | Saved server presets for quick switching | `[]` |
| `private.model.provider.defaultModel` | `string` | Default model ID to use (leave empty for auto-select) | `""` |
| `private.model.provider.smallModel` | `string` | Small model ID for summarization and title generation tasks (leave empty to use default model) | `""` |
| `private.model.provider.requestTimeout` | `number` | Request timeout in milliseconds | `60000` |
| `private.model.provider.defaultMaxTokens` | `number` | Default maximum input tokens for models (context window) | `32768` |
| `private.model.provider.defaultMaxOutputTokens` | `number` | Default maximum output tokens for models | `4096` |
| `private.model.provider.enableToolCalling` | `boolean` | Enable tool calling capability for models | `true` |
| `private.model.provider.parallelToolCalling` | `boolean` | Allow model to call multiple tools in parallel | `true` |
| `private.model.provider.agentTemperature` | `number` | Temperature for agent/tool calling mode (0.0-2.0) | `0` |
| `private.model.provider.topP` | `number` | Top-p (nucleus) sampling parameter (0.0-1.0) | `1` |
| `private.model.provider.frequencyPenalty` | `number` | Frequency penalty to reduce repetition (-2.0 to 2.0) | `0` |
| `private.model.provider.presencePenalty` | `number` | Presence penalty to encourage talking about new topics (-2.0 to 2.0) | `0` |
| `private.model.provider.systemPromptOverride` | `string` | Override the system prompt sent to the LLM | `""` |
| `private.model.provider.maxRetries` | `number` | Maximum number of retry attempts for failed requests (0-10) | `3` |
| `private.model.provider.retryDelayMs` | `number` | Base delay in milliseconds between retry attempts | `1000` |
| `private.model.provider.modelCacheTtlMs` | `number` | How long to cache the model list in milliseconds | `300000` |
| `private.model.provider.logLevel` | `string` | Logging verbosity level (debug, info, warn, error) | `info` |

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
2. Run **Private Model Provider: Set API Key** (a command you will add in `extension.ts`).
3. Enter the key – it will be stored securely.

## Example `settings.json`
```json
{
    "private.model.provider.serverUrl": "http://localhost:8000",
    "private.model.provider.defaultModel": "llama3.1:8b",
    "private.model.provider.smallModel": "llama3.2:1b",
    "private.model.provider.requestTimeout": 60000,
    "private.model.provider.defaultMaxTokens": 32768,
    "private.model.provider.defaultMaxOutputTokens": 4096,
    "private.model.provider.enableToolCalling": true,
    "private.model.provider.parallelToolCalling": true,
    "private.model.provider.agentTemperature": 0,
    "private.model.provider.topP": 1,
    "private.model.provider.frequencyPenalty": 0,
    "private.model.provider.presencePenalty": 0,
    "private.model.provider.systemPromptOverride": "",
    "private.model.provider.maxRetries": 3,
    "private.model.provider.retryDelayMs": 1000,
    "private.model.provider.modelCacheTtlMs": 300000,
    "private.model.provider.logLevel": "info"
}
```

## Session Title Generation

When `private.model.provider.smallModel` is configured, the extension will use this model to automatically generate concise session titles based on the first user message. The default prompt requests a 10-word summary, but you can customize this by creating a `.llm/session.summary.md` file in your workspace root.

### Custom Summary Prompt

Create a file at `.llm/session.summary.md` in your workspace:
```markdown
Summarize the following message in 10 words or less, focusing on the main topic:

{{message}}
```

The `{{message}}` placeholder will be replaced with the first user message in the session.

If no custom template is found, the default prompt is used:
```
Please provide a concise title (10 words or less) for a conversation that starts with this message: "{{message}}"
```

If `smallModel` is not configured, the extension will fall back to using the `defaultModel` for title generation.