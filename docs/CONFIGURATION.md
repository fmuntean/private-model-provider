# Configuration Guide

All user settings are under the `private.model.provider.*` namespace. Configure them from VS Code Settings or `settings.json`.

## Settings

| Setting | Type | Default | Description |
|---|---:|---:|---|
| `private.model.provider.serverUrl` | `string` | `http://localhost:8000` | Base URL for the OpenAI-compatible inference server. Do not include `/v1`; the extension appends API paths. |
| `private.model.provider.serverPresets` | `array` | `[]` | Saved `{ name, url }` presets used by **Switch Server Preset**. |
| `private.model.provider.defaultModel` | `string` | `""` | Default model name/ID used when no model is selected. Empty means auto-select from available models. |
| `private.model.provider.smallModel` | `string` | `""` | Optional smaller model for title generation and prompt tasks. Falls back to the selected/default model. |
| `private.model.provider.requestTimeout` | `number` | `60000` | HTTP request timeout in milliseconds. |
| `private.model.provider.defaultMaxTokens` | `number` | `32768` | Estimated context window used for request budgeting. |
| `private.model.provider.defaultMaxOutputTokens` | `number` | `4096` | Maximum generated tokens requested from the server. |
| `private.model.provider.enableToolCalling` | `boolean` | `true` | Enables OpenAI-style function/tool calling. |
| `private.model.provider.parallelToolCalling` | `boolean` | `true` | Sends `parallel_tool_calls` when supported. Disable for stricter servers such as some LM Studio setups. |
| `private.model.provider.agentTemperature` | `number` | `0` | Temperature used for tool/agent requests and sidebar requests. |
| `private.model.provider.topP` | `number` | `1` | Nucleus sampling value. Omitted from some requests when defaulted. |
| `private.model.provider.frequencyPenalty` | `number` | `0` | Frequency penalty. |
| `private.model.provider.presencePenalty` | `number` | `0` | Presence penalty. |
| `private.model.provider.maxRetries` | `number` | `3` | Maximum retry attempts for transient request failures. |
| `private.model.provider.retryDelayMs` | `number` | `1000` | Base retry delay in milliseconds; exponential backoff and jitter are applied. |
| `private.model.provider.modelCacheTtlMs` | `number` | `300000` | Model list cache duration in milliseconds. Use `0` to effectively disable caching. |
| `private.model.provider.logLevel` | `string` | `warn` | Output verbosity: `debug`, `info`, `warn`, or `error`. |
| `private.model.provider.mcpServers` | `array` | `[]` | MCP server process definitions. |
| `private.model.provider.enabledMcpTools` | `array` | `[]` | Whitelist of MCP tool names allowed to be sent to the model. |
| `private.model.provider.availableMcpTools` | `array` | `[]` | Tool names available for selection in the UI. |

`availableMcpTools` is currently declared outside the `properties` object in `package.json`, so VS Code may not expose it like the other settings until that contribution schema is corrected.

## API Key Storage

The API key is not stored in `settings.json`. Use the command:

```text
Private Model Provider: Set API Key (Secure)
```

The value is stored in VS Code SecretStorage with key:

```text
private.model.provider.apiKey
```

For migration, `SecretManager.getApiKey()` checks a legacy `private.model.provider.apiKey` setting, moves it into SecretStorage, and clears the setting.

## Example `settings.json`

```json
{
  "private.model.provider.serverUrl": "http://localhost:8000",
  "private.model.provider.serverPresets": [
    { "name": "vLLM", "url": "http://localhost:8000" },
    { "name": "LM Studio", "url": "http://localhost:1234" }
  ],
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
  "private.model.provider.maxRetries": 3,
  "private.model.provider.retryDelayMs": 1000,
  "private.model.provider.modelCacheTtlMs": 300000,
  "private.model.provider.logLevel": "warn",
  "private.model.provider.mcpServers": [
    {
      "name": "exampleTool",
      "command": "node",
      "args": ["server.js"],
      "transport": "stdio",
      "env": {}
    }
  ],
  "private.model.provider.enabledMcpTools": ["exampleTool"]
}
```

## Server Presets

The **Switch Server Preset** command lets you:

- Select a saved preset.
- Add a new server URL and save it as a preset.
- Delete existing presets.
- Immediately refresh the model list after switching.

Common URLs:

| Server | URL |
|---|---|
| vLLM | `http://localhost:8000` |
| Ollama | `http://localhost:11434` |
| llama.cpp | `http://localhost:8080` |
| LM Studio | `http://localhost:1234` |

## Prompt Files

| File | Purpose |
|---|---|
| `.llm/master.md` | Workspace master prompt prepended to conversations when available. |
| `.llm/session.summary.md` | Optional title-generation prompt template. Supports `{{message}}`. |
| `.llm/prompts/<model-id>/system.md` | Model-specific system prompt generated by **Generate System Prompts**. |
| `.llm/prompts/<model-id>/title.md` | Model-specific title prompt generated by **Generate System Prompts**. |

Packaged base templates currently exist as `PromptTemplates/System.md` and `PromptTemplates/Title.md`. The `PromptManager.readBasePromptTemplate()` implementation looks for lowercase `system.md` and `title.md`, so **Generate System Prompts** may fail until the filenames or lookup logic are aligned.

## Session Title Generation

When the first message creates a session, the extension generates a title asynchronously:

1. It prefers `private.model.provider.smallModel` when set.
2. It otherwise uses the current/default model.
3. It reads `.llm/session.summary.md` if present.
4. It falls back to an internal 10-word title prompt.
5. The saved title is truncated to 50 characters by `SessionManager`.
