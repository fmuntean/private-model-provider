# Chat Interface

## Overview

The extension provides a dedicated **Private Model** sidebar webview for chatting with a configured OpenAI-compatible server. It does not replace GitHub Copilot Chat; it is a separate private chat UI alongside the VS Code language model provider integration.

## Opening the Chat

1. Open the **Private Model** activity container in the VS Code activity bar.
2. Select the **LMP** webview.
3. Pick a model from the dropdown when models are available.
4. Type a message and press **Enter** or click **Send**.
5. Use **Shift+Enter** to insert a newline.

## Current Features

- **Session list**: the webview opens on the session list and can switch into a chat session.
- **Streaming responses**: assistant output is appended as chunks arrive.
- **Reasoning display**: streamed reasoning/thinking fields are rendered separately when the server emits them.
- **Token usage display**: final server `usage` is shown after a streamed response when available.
- **Model selector**: models are fetched from the provider and shown in the webview dropdown.
- **Master prompt**: editable with the registered `private-model-provider.editMasterPrompt` command and saved to `.llm/master.md`.
- **Session titles**: generated from the first user message with `smallModel` or the active/default model.

## Controls

| Control | Behavior |
|---|---|
| **Send** | Sends the current message. |
| **Stop** | Posts a stop request to the extension. Full cancellation handling is still limited in the current webview path. |
| **Model dropdown** | Selects the model ID used for subsequent messages in the current UI session. |
| **Back arrow** | Returns from a chat session to the session list. |
| **Session item** | Switches the webview to that saved session. |

The current webview does not implement separate Clear, Export, or Import buttons.

## Session Storage

- Metadata is written to `ai-logs/sessions.json`.
- Message history is written to `ai-logs/YYYY-MM-DD/HHMM-<sessionId>.jsonl`.
- If no workspace is open, the extension uses VS Code global storage.

## FAQ

- **Where are API keys stored?** They are stored in VS Code SecretStorage under `private.model.provider.apiKey`.
- **Which server URL setting is used?** Use `private.model.provider.serverUrl`, for example `http://localhost:8000`.
- **How is token usage calculated?** Server-returned `usage` is preferred. Token budgeting uses an approximate character-based estimate when preparing requests.
