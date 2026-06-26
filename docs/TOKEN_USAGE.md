# Token Usage Guide

## Token Sources

The extension uses two kinds of token information:

1. **Server usage**: final OpenAI-compatible `usage` data with `prompt_tokens`, `completion_tokens`, and `total_tokens`.
2. **Estimated tokens**: a fast character-based estimate used before requests to budget context and output size.

Server usage is preferred for statistics whenever it is returned.

## Tracking Flow

1. `LlmClient.streamChatCompletion()` requests `stream_options.include_usage`.
2. The final usage chunk is captured and yielded at stream completion.
3. `GatewayProvider` records usage through `StatisticsManager.recordChatUsage()`.
4. `GatewayProvider` updates session token usage through `SessionManager.updateTokenUsage()`.
5. `StatusBarManager.updateStats()` reflects totals in the VS Code status bar.
6. The sidebar webview displays response usage when `messageDone` includes `usage`.

## What Is Stored

`StatisticsManager` tracks:

- Total requests.
- Total input tokens.
- Total output tokens.
- Average and last response time.
- Per-model requests, input tokens, and output tokens.

`SessionManager` tracks token usage by message type:

- `prompt`
- `context`
- `user`
- `agent`
- `tools`

Session metadata is saved to `ai-logs/sessions.json` when a workspace is open.

## Viewing Usage

- **Sidebar response**: displays final response usage and token speed when the server returns usage.
- **Status bar**: displays aggregate token/status information.
- **Command palette**: run **Private Model Provider: View Usage Statistics**.
- **Stats dialog**: can reset runtime statistics with **Reset Statistics**.

## Managing Limits

Use these settings:

| Setting | Purpose |
|---|---|
| `private.model.provider.defaultMaxTokens` | Estimated context window used for input budgeting. |
| `private.model.provider.defaultMaxOutputTokens` | Maximum output tokens requested from the server. |
| `private.model.provider.modelCacheTtlMs` | Model metadata cache duration. |

The provider calculates a safe request budget from estimated input tokens, desired output tokens, tool overhead, and a small reserve. If the output limit is greater than or equal to the context limit, the provider adjusts it downward.

## Notes

- Token tracking is not currently controlled by a `showTokenStats` setting.
- There is no `maxDailyTokens` warning setting in the current implementation.
- Clearing a chat is not exposed in the current sidebar UI.
