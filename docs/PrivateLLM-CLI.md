# Private Model Provider – CLI Manual

## Overview
The **Private Model Provider** extension ships with a small command‑line interface (CLI) that lets you interact with a configured local LLM directly from a terminal.  The CLI mirrors the functionality of the VS Code chat UI – you can send prompts, receive streamed responses, and view token usage – but it runs outside the editor, which is useful for scripting, automation, or when you prefer a terminal‑first workflow.

## Installation
The CLI is bundled with the extension and is available after the extension is installed.  No additional npm packages are required.

1. Ensure the extension is installed in VS Code (`fmuntean.private-model-provider`).
2. Open a terminal in the workspace root (`c:\GIT\private-model-provider`).
3. Run the CLI via `npx private-model-cli` (or `npm run cli` if a script is defined).

> **Tip:** If you want a global command, you can add a symlink or add `node_modules/.bin` to your `PATH`.

## Configuration
The CLI reads the same configuration as the extension from VS Code settings.  It looks for a `settings.json` file in the workspace (or the global VS Code settings) and uses the `private.model.provider.*` namespace.

Required settings:
- `private.model.provider.serverUrl` – Base URL of the OpenAI‑compatible inference server (e.g. `http://localhost:8000`).
- `private.model.provider.defaultModel` – Model ID to use when none is supplied on the command line.

Optional settings (see `docs/CONFIGURATION.md` for full list):
- `private.model.provider.requestTimeout`
- `private.model.provider.enableToolCalling`
- `private.model.provider.agentTemperature`
- `private.model.provider.maxRetries`

The CLI also supports an environment variable `PRIVATE_MODEL_API_KEY` for authentication.  If the server requires an API key and you have stored it via the VS Code command **“Private Model Provider: Set API Key (Secure)”**, the CLI will automatically read it from the VS Code secret storage.  For headless environments you can export the variable:
```bash
export PRIVATE_MODEL_API_KEY="your‑key"
```

## Usage
```
private-model-cli [options] <prompt>
```

### Options
| Flag | Alias | Description | Default |
|------|-------|-------------|---------|
| `--model <id>` | `-m` | Model ID to use for this request. Overrides `defaultModel`. | (value from settings) |
| `--max-tokens <n>` | `-t` | Maximum output tokens. | `private.model.provider.defaultMaxOutputTokens` |
| `--temperature <float>` | `-T` | Sampling temperature (0‑2). | `private.model.provider.agentTemperature` |
| `--no-tool-calling` | | Disable function calling for this request. | (enabled if configured) |
| `--stream` | `-s` | Force streaming output (default). |
| `--no-stream` | | Disable streaming – wait for full response before printing. |
| `--json` | `-j` | Output the raw OpenAI JSON response (including `usage`). |
| `--help` | `-h` | Show help message. |

### Example
```bash
# Simple prompt using the default model
private-model-cli "Explain the difference between GPT‑4 and LLaMA‑2."

# Specify a model and limit output tokens
private-model-cli -m llama3.1:8b -t 512 "Write a short Python script that reads a CSV and prints the first 5 rows."

# Get raw JSON response for programmatic consumption
private-model-cli -j "List the top 3 most popular VS Code extensions."
```

The CLI prints the assistant’s reply to `stdout`.  If streaming is enabled (default), each chunk is printed as it arrives, giving a live‑typing effect similar to the VS Code chat.

## Token Usage
When the request finishes, the CLI prints a summary line to `stderr`:
```
[Tokens] prompt: 123 | completion: 456 | total: 579
```
If `--json` is used, the `usage` object is included in the JSON output.

## Scripting Example (Bash)
```bash
#!/usr/bin/env bash
set -euo pipefail

PROMPT="Summarize the following text in one sentence: $1"
RESPONSE=$(private-model-cli -j "$PROMPT")
# Extract the assistant message using jq
MESSAGE=$(echo "$RESPONSE" | jq -r '.choices[0].message.content')

echo "Summary: $MESSAGE"
```

## Troubleshooting
- **Server not reachable** – Verify the URL with `curl $SERVER_URL/v1/models`.  Check the `serverUrl` setting.
- **Authentication error** – Ensure the API key is stored (`PRIVATE_MODEL_API_KEY` env var) or set via the VS Code command.
- **Empty response** – Disable tool calling (`--no-tool-calling`) to see if the model returns plain text.
- **Timeouts** – Increase `private.model.provider.requestTimeout` or pass `--timeout <ms>` (future enhancement).
- **Tool‑call formatting errors** – Use `--no-tool-calling` or lower `--temperature` to `0`.

## FAQ
- **Can I use the CLI without VS Code installed?** – Yes, the CLI is a pure Node.js script.  As long as the workspace contains the extension’s `package.json` and `node_modules`, you can run it.
- **Does the CLI support multi‑turn conversations?** – Currently the CLI is stateless – each invocation is a single request.  For multi‑turn chats you can pipe the output to a file and feed it back as `messages` in a custom script.
- **Where are logs written?** – Logs respect the `logLevel` setting and are written to the VS Code extension log file (`%APPDATA%\Code\logs`).  Use `--debug` (future flag) to increase verbosity.

---
*This manual is intended for end‑users who want to interact with the Private Model Provider from the command line.*