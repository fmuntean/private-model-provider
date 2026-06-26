# Private Model Provider – VS Code Language Model Integration

## Overview

Private Model Provider registers a VS Code `LanguageModelChatProvider` with vendor ID:

```text
private-model-provider
```

Other VS Code chat surfaces that can select language model providers may route requests to this provider. The extension forwards those requests to your configured OpenAI-compatible server.

## Setup

1. Install the extension.
2. Configure `private.model.provider.serverUrl`, for example `http://localhost:8000`.
3. If your server requires authentication, run **Private Model Provider: Set API Key (Secure)**.
4. Run **Private Model Provider: Test Connection** or **Refresh Model Cache**.
5. Select a model from the VS Code model picker or run **View Models & Set Default**.

## Configuration Options

| Setting | Description | Default |
|---|---|---|
| `private.model.provider.serverUrl` | Base URL of the OpenAI-compatible endpoint. | `http://localhost:8000` |
| `private.model.provider.defaultModel` | Default model name/ID used when no model is selected. | `""` |
| `private.model.provider.defaultMaxTokens` | Estimated context window for budgeting. | `32768` |
| `private.model.provider.defaultMaxOutputTokens` | Requested generation limit. | `4096` |
| `private.model.provider.enableToolCalling` | Enables OpenAI-style tool calls. | `true` |
| `private.model.provider.parallelToolCalling` | Sends parallel tool-call support when enabled. | `true` |
| `private.model.provider.agentTemperature` | Temperature for tool/agent requests. | `0` |
| `private.model.provider.requestTimeout` | HTTP timeout in milliseconds. | `60000` |
| `private.model.provider.maxRetries` | Retry attempts for transient failures. | `3` |
| `private.model.provider.logLevel` | Logging verbosity. | `warn` |

See `docs/CONFIGURATION.md` for the full list.

## Request Behavior

- Models are fetched from `/v1/models`.
- LM Studio metadata is additionally probed from `/api/v1/models`.
- Chat requests are sent to `/v1/chat/completions`.
- Streaming is used for provider responses.
- The client requests final usage with `stream_options.include_usage`.
- Tool calls are passed in OpenAI `tools` format when available and enabled.

## Privacy

The extension sends request data to the configured `serverUrl`. It does not intentionally send chat content to Microsoft or OpenAI from this provider path. Other VS Code extensions or chat clients may have their own behavior, so choose the client surface accordingly.

## Troubleshooting

- **Models do not appear**: verify `curl http://HOST:PORT/v1/models`, then run **Refresh Model Cache**.
- **Authentication failures**: set the key with **Set API Key (Secure)** and confirm your server expects `Authorization: Bearer <key>`.
- **Empty output**: disable `enableToolCalling` to test plain chat.
- **Tool-call formatting errors**: disable `parallelToolCalling` and keep `agentTemperature` at `0`.
- **LM Studio errors**: use `http://localhost:1234` and do not include `/v1`.

For internal architecture, see `docs/ARCHITECTURE.md`.
