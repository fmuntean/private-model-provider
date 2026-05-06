# Chat Interface

## Overview
This extension replaces the built‑in GitHub Copilot chat with a full‑featured ChatGPT‑style interface. Users can open the **Local Model Chat** command, type prompts, and receive responses from a configurable LLM endpoint.

## Getting Started
1. Open the command palette (`Ctrl+Shift+P`).
2. Run **Local Model Chat: Open**.
3. Type a message in the input box and press **Enter** or click **Send**.
4. The response appears in the chat pane. Token usage is shown in the status bar.

## Features
- **Master Prompt** – edit the system prompt that is prepended to every request.
- **Context Management** – clear, export, or import conversation history.
- **Token Tracking** – per‑session and cumulative token counts.
- **Settings** – configure endpoint, model, temperature, max tokens, and API key.
- **Dark/Light Theme** – UI respects VS Code theme.
- **Error Handling** – friendly messages for network or authentication errors.

## Controls
| Control | Description |
|---------|-------------|
| **Send** | Submit the current user message. |
| **Clear Chat** | Remove all messages and reset context. |
| **Export** | Save the current conversation to a JSON file. |
| **Import** | Load a previously exported conversation. |
| **System Prompt** | Edit the master prompt that guides the assistant. |
| **Token Stats** | View tokens used for the current session in the status bar. |

## FAQ
- **Where are my API keys stored?**  They are saved securely using VS Code's `SecretStorage` API.
- **Can I use a local model (e.g., Ollama)?**  Yes – set the `localModelProvider.endpoint` to your local server URL.
- **How is token usage calculated?**  The LLM provider returns a `usage` object (prompt/completion/total tokens) which is aggregated by the extension.

---
*For more technical details, see the other docs in this folder.*