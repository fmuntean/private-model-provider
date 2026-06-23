# Private Model Provider – GitHub Copilot Integration

## Overview
The **Private Model Provider** extension can act as an external provider for GitHub Copilot (or any other AI chat that uses the VS Code *LanguageModelChatProvider* API).  When enabled, all Copilot requests are routed to a self‑hosted or locally‑run LLM that implements the OpenAI Chat Completions API (vLLM, Ollama, LM Studio, Text Generation Inference, LocalAI, etc.).

## Enabling the Provider
1. **Install the extension** from the VS Code Marketplace.
2. Open **Settings** (`Ctrl+,`) and search for `private.model.provider`.
3. Set the required `private.model.provider.serverUrl` to the base URL of your inference server (e.g. `http://localhost:8000`).
4. (Optional) Run the command **“Private Model Provider: Set API Key (Secure)”** to store an API key in VS Code SecretStorage if your server requires authentication.
5. Reload VS Code (or click *Reload* in the prompt that appears after installation).
6. Open the **GitHub Copilot** UI – the extension will automatically register itself as a language‑model provider.  You can verify the connection via the status‑bar health monitor.

## Configuration Options
| Setting | Description | Default |
|---|---|---|
| `private.model.provider.serverUrl` | Base URL of the OpenAI‑compatible endpoint. | `http://localhost:8000` |
| `private.model.provider.defaultModel` | Model ID used when no model is explicitly selected. | `""` (auto‑select) |
| `private.model.provider.enableToolCalling` | Enable function‑calling support for models that support it. | `true` |
| `private.model.provider.parallelToolCalling` | Allow the model to call multiple tools in parallel. | `true` |
| `private.model.provider.agentTemperature` | Temperature used when the model is in tool‑calling mode. | `0` |
| `private.model.provider.requestTimeout` | HTTP request timeout (ms). | `60000` |
| `private.model.provider.maxRetries` | Number of retry attempts for transient failures. | `3` |
| `private.model.provider.logLevel` | Logging verbosity (`debug`, `info`, `warn`, `error`). | `info` |

## Using Copilot with the Private Provider
- The workflow is identical to the built‑in Copilot experience: type a comment or start a suggestion and Copilot will return completions.
- All network traffic is sent **only** to the server you configured; no data is sent to Microsoft’s cloud.
- Tool‑calling (function calls) works out‑of‑the‑box for models that support the OpenAI function‑calling format.  If you encounter malformed tool calls, consider disabling `enableToolCalling`.

## Troubleshooting
- **Models do not appear** – Verify the server is reachable (`curl http://HOST:PORT/v1/models`).  Check the `serverUrl` setting and run **“Private Model Provider: Test Server Connection”**.
- **Empty responses** – Ensure the server is started with the correct `--tool-call-parser` flag.  Disable tool calling to test plain chat.
- **Tool‑call formatting errors** – Set `parallelToolCalling` to `false` and/or lower `agentTemperature` to `0`.
- **Authentication failures** – Confirm the API key is stored via **“Set API Key (Secure)”** and that the server expects the key in the `Authorization` header.
- **Connection errors** – Increase `requestTimeout` (e.g., `120000`) for large models that take longer to load.

For a deeper dive into the internal architecture, see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
