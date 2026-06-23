# Private Model Provider – Chat Interface Manual

## Overview
Some of the Chat extensions could send some of the interation to their servers for example to generate a title or sumarize the content. 

The **Private Model Chat** is a full‑featured, Copilot‑style chat UI that runs inside VS Code. It replaces the built‑in GitHub Copilot chat and routes all messages to a locally hosted or self‑hosted LLM via the OpenAI‑compatible API.


## Getting Started
1. **Open the chat** – Press `Ctrl+Shift+P` and run **“Private Model Chat: Open”** (or click the chat icon in the status bar).
2. The chat webview appears on the right side of the editor.
3. Choose a model from the dropdown at the top‑right of the chat pane. If no model is selected, the extension uses the `defaultModel` configured in `settings.json`.
4. Type your prompt in the input box and press **Enter** or click **Send**.

## Main Controls
| Control | Action |
|---|---|
| **Send** | Submits the current user message. |
| **Clear Chat** | Removes all messages from the current session and resets the context. |
| **Export** | Saves the conversation to a JSON file (`*.jsonl`). |
| **Import** | Loads a previously exported conversation, restoring the message history. |
| **System Prompt** | Opens a dialog to edit the master system prompt that is prepended to every request. |
| **Token Stats** | Shows the number of tokens used in the current session (displayed in the status bar). |
| **Stop** | Cancels an in‑progress streaming request. |

## Session Management
- **Automatic Title Generation** – When a new session is created, the extension generates a concise title (≈10 words) using the configured `smallModel` or the `defaultModel`. You can customise the prompt by creating a `.llm/session.title.md` file in the workspace root.
- **History Persistence** – All sessions are saved under `ai-logs/YYYY‑MM‑DD/HHMM‑<sessionId>.jsonl`. You can view them later via the **Session List** view in the chat sidebar.
- **Export / Import** – Use the **Export** button to save a session to a file, and **Import** to load it back. This is useful for sharing or archiving conversations.

## Configuration
Most settings are under the `private.model.provider.*` namespace. Relevant options for the chat UI include:
- `private.model.provider.serverUrl` – Base URL of your inference server.
- `private.model.provider.defaultModel` – Model used when none is selected.
- `private.model.provider.smallModel` – Model used for title generation.
- `private.model.provider.enableToolCalling` – Enable OpenAI‑style function calling.
- `private.model.provider.agentTemperature` – Temperature for tool‑calling mode (default `0`).
- `private.model.provider.topP`, `frequencyPenalty`, `presencePenalty` – Sampling parameters.

## Token Tracking
The extension displays two token counters:
1. **Current Session** – Shown in the chat status bar (e.g., `Tokens: 1234`).
2. **Cumulative** – Aggregated across all sessions and shown in the status‑bar health monitor.

## Troubleshooting
- **No response / empty output** – Verify the server is reachable (`curl $SERVER_URL/v1/models`).  Disable `enableToolCalling` to test plain chat.
- **Tool‑call errors** – Set `parallelToolCalling` to `false` and/or lower `agentTemperature` to `0`.
- **Authentication failures** – Ensure the API key is stored via **“Private Model Provider: Set API Key (Secure)”**.
- **Connection timeouts** – Increase `private.model.provider.requestTimeout` (e.g., `120000`).

For a deeper technical description of the chat flow, see [`docs/sendMessage.md`](sendMessage.md).

---
*This manual is intended for end‑users of the Private Model Provider extension.*