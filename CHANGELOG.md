# Changelog

## 1.2.14

### New Features
- Added GeminiClient and LmStudioClient support.
- Added UI assets and session management implementation.
- Implemented US-022 Test Connection command registration.

### Improvements
- Refactored Client and Provider to use internal interfaces.
- Split provider for re-usability (CopilotProvider and ChatProvider).
- Renamed extension to Private Model Provider.
- Updated extension icon.
- Updated project configuration and dependencies.
- Updated prompt templates and core extension functionality.
- Removed system prompt override feature.

### Fixes
- Improved handling of API Keys.
- Made SecretManager a singleton.
- Fixed API key retention when updating config.
- Fixed packaging and auto-increment patch version upon vsix generation.
- Fixed model dropdown refresh and test connection cache handling.
- Added jsnol ai-logs to the workspace.


## 1.2.3

### New Features
- Added richer Private LLM chat behavior, including session management, session title handling, prompt placeholder support, and a dedicated VS Code sidebar webview.
- Added visible reasoning/thinking blocks in the chat view for models that stream reasoning fields.
- Added token generation speed calculation and display for streamed responses.
- Added MCP tool selection support so enabled tools can be controlled before sending tool definitions to the model.
- Added server connection testing and improved model refresh behavior from the command palette and status flows.

### Improvements
- Renamed the extension and documentation from Local Model Provider to Private Model Provider.
- Refactored extension command registration out of `extension.ts` into `commands.ts` for clearer activation logic.
- Moved shared logging and LLM client functionality into `src/core/` and updated callers to use the core `LlmClient`.
- Improved model information retrieval, including better handling for richer server metadata.
- Updated dependencies and package metadata for the current VS Code extension layout.
- Updated the extension icon and packaged asset set.

### Fixes
- Fixed model dropdown refresh and test connection cache handling.
- Fixed chat textarea behavior so Enter sends and Shift+Enter inserts a newline.
- Made chat session titles sticky in the chat view.
- Fixed VSIX packaging by bundling from `out/`, including webview assets, and adding patch auto-increment during package generation.

## 1.1.2

### Improvements
- Fixed "terminated" / "request failed" errors when connecting to LM Studio and similar servers
- Replaced `TextDecoderStream` + `pipeThrough` with plain `TextDecoder` to avoid stream termination in certain runtimes
- Gracefully handle stream disconnection when data has already been received (some servers close without sending `[DONE]`)
- Added `\r\n` line ending support in SSE stream parsing
- Only send `top_p`, `frequency_penalty`, `presence_penalty` when non-default to avoid rejection by servers that don't accept unknown parameters
- Only send `parallel_tool_calls` when enabled (LM Studio rejects this field)
- Improved "terminated" error messages with actionable troubleshooting steps
- Added LM Studio to compatible servers list, keywords, and README setup guide

## 1.1.1

### Bug Fixes
- Prevented premature message truncation caused by an overly conservative token estimate. We now compute a real input-token estimate for the full conversation first and only truncate when it truly exceeds the available context window. This resolves cases where input was truncated despite ample room.
- Clearer token budgeting: context is now calculated as `model_context - desired_output - tools_overhead - buffer` and truncation is gated on the real estimate against this value.

## 1.1.0

- Fixed UTF-8 decoding issues causing garbled characters (e.g. arrows) by implementing `TextDecoderStream`
- Improved stream processing stability and ensured all data is flushed at the end of the response
- Fixed missing property error in tool call state creation

## 1.0.9

- Ensure model list refresh after server switch
- Apply latest config immediately on serverUrl update to avoid stale models
- Minor UX tweaks in server preset picker

## 1.0.8

### Bug Fixes
- Fixed server switching not immediately reflecting in "Manage Language Models" menu
- Fixed new preset creation not loading models from the new server

### Improvements
- Server switching now fetches models immediately with progress notification
- New preset creation now validates server connection and displays model count
- Enhanced user feedback when switching servers (shows model count or error)

## 1.0.7

### New Features
- **Delete Server Presets**: Remove saved server presets with confirmation dialog

### Improvements
- Server preset menu now shows delete option when presets exist
- Better model selection responsiveness with immediate cache refresh

## 1.0.6

### New Features
- **Model Viewer & Default Selection**: View available models and quickly set a default model
- **Server Presets**: Save and switch between multiple server configurations (vLLM, Ollama, OpenAI, etc.)
- **Token Usage Statistics**: Track input/output tokens and view per-model statistics
- **Response Time Monitoring**: Display last response time in status bar, track average response times
- **Manual Model Refresh**: Refresh model cache on demand via command

### Improvements
- Enhanced status bar with session statistics in tooltip
- New quick actions menu with all features accessible
- Added 4 new commands: View Models, Switch Server, View Statistics, Refresh Models
- Removed redundant "Test Connection" command (consolidated into Refresh Models)
- Enhanced "Refresh Models" to display model names in the success message

## 1.0.5

- Lowered minimum VS Code engine version to 1.100.0 for Antigravity compatibility

## 1.0.4

- Added reasoning/thinking content output support for models like o1, o3, Claude, etc.

## 1.0.3

- Fixed error when using API Key

## 1.0.2

- Bug fixes

## 1.0.1

- Bug fixes
