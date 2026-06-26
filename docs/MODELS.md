# Model Compatibility Notes

Private Model Provider works best with models and servers that implement the OpenAI Chat Completions API.

## Required Server Endpoints

| Endpoint | Required For |
|---|---|
| `GET /v1/models` | Model discovery in VS Code and the sidebar dropdown. |
| `POST /v1/chat/completions` | Chat completions, streaming, usage tracking, and tool calling. |

LM Studio is also probed at `/api/v1/models` for richer metadata when available.

## Recommended Capabilities

- Server-sent events (SSE) streaming.
- Final `usage` chunks with `prompt_tokens`, `completion_tokens`, and `total_tokens`.
- OpenAI-style `tools` / `tool_calls` for tool-capable workflows.
- Reasoning fields such as `reasoning_content`, `reasoning`, or `thinking` if you want reasoning blocks shown in the sidebar.

## Server Notes

| Server | Notes |
|---|---|
| vLLM | Recommended for production-like self-hosting. Enable the appropriate tool-call parser for tool-capable models. |
| LM Studio | Use `http://localhost:1234` without `/v1`. Disable `parallelToolCalling` if the server rejects `parallel_tool_calls`. |
| Ollama | Use the OpenAI-compatible API surface. Tool support depends on model/server support. |
| llama.cpp | Works when launched with an OpenAI-compatible server mode. |
| LocalAI / TGI | Expected to work when exposing compatible model and chat completion endpoints. |

## Model Selection Guidance

- Use a larger coding model for normal chat and provider requests.
- Use `private.model.provider.smallModel` for faster session title generation.
- If tool calls are malformed, set `agentTemperature` to `0`, disable `parallelToolCalling`, or disable `enableToolCalling`.
- If responses truncate too early, increase `defaultMaxTokens` and/or `defaultMaxOutputTokens` to match your model's real context window.
- If the server rejects sampling fields, keep `topP`, `frequencyPenalty`, and `presencePenalty` at defaults.
