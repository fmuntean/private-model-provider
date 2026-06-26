# Contributing to Private Model Provider

Thanks for helping improve Private Model Provider. This project is a VS Code extension that connects GitHub Copilot Chat, the built-in Private LLM chat view, and related tooling to local or self-hosted OpenAI-compatible inference servers.

## Project at a Glance

Private Model Provider currently supports:

- VS Code language model provider registration through `vscode.lm.registerLanguageModelChatProvider`.
- OpenAI-compatible `/v1/models` and `/v1/chat/completions` requests.
- Streaming chat responses, reasoning fields, usage accounting, retries, and tool calls.
- MCP tool discovery and selection.
- A VS Code sidebar chat webview with session management.
- Server presets, status bar health checks, secure API key storage, and usage statistics.

## Development Setup

### Prerequisites

- Node.js 18 or later.
- npm 9 or later.
- VS Code 1.100.0 or later.
- Git.
- An OpenAI-compatible inference server for manual testing, such as vLLM, LM Studio, Ollama, llama.cpp, LocalAI, or TGI.

### Install and Build

```bash
npm install
npm run esbuild
```

For continuous rebuilds while working:

```bash
npm run esbuild-watch
```

To type-check without bundling:

```bash
npm run test-compile
```

To package a local VSIX:

```bash
npm run package
```

`npm run package` runs `vsce package --no-yarn`. The `prepackage` script also bumps the patch version with `npm version patch --no-git-tag-version`, so check `package.json` and `package-lock.json` before committing after packaging.

## Running the Extension

1. Open this repository in VS Code.
2. Run `npm install` if dependencies are not already installed.
3. Press `F5` to launch an Extension Development Host.
4. Configure `private.model.provider.serverUrl`, for example `http://localhost:8000`.
5. If your server requires authentication, run `Private Model Provider: Set API Key (Secure)`.
6. Test from the Private Model sidebar, GitHub Copilot Chat model picker, and the command palette.

## Project Structure

```text
private-model-provider/
├── src/
│   ├── extension.ts          # Extension activation, provider registration, commands, views
│   ├── provider.ts           # VS Code language model provider implementation
│   ├── commands.ts           # Command palette handlers and quick-pick flows
│   ├── config.ts             # Extension configuration loading
│   ├── mcp.ts                # MCP server and tool integration
│   ├── prompts.ts            # Prompt template management
│   ├── secretManager.ts      # VS Code SecretStorage API key handling
│   ├── sessionManager.ts     # Chat session persistence and metadata
│   ├── statistics.ts         # Usage and token statistics
│   ├── statusBar.ts          # Status bar health and actions
│   ├── core/
│   │   ├── llmClient.ts      # OpenAI-compatible HTTP client and streaming parser
│   │   ├── interfaces.ts     # Core interfaces
│   │   └── BaseLogger.ts     # Shared logger base
│   └── ui/
│       ├── chatView.ts       # Chat webview provider
│       ├── sessionView.ts    # Session view provider
│       └── assets/           # Webview HTML, CSS, and browser JavaScript
├── PromptTemplates/          # Built-in prompt templates
├── docs/                     # Architecture, configuration, and feature docs
├── Requirements/             # Requirements and traceability docs
├── assets/                   # Extension icon and screenshots
├── package.json              # VS Code manifest and npm scripts
└── tsconfig.json             # TypeScript compiler configuration
```

## Main Areas of Responsibility

- `src/core/llmClient.ts`: keep OpenAI-compatible request and streaming behavior tolerant of server differences. Changes here should be tested against at least one real server.
- `src/provider.ts`: preserve VS Code language model provider contracts, model metadata, tool handling, and cancellation behavior.
- `src/ui/assets/`: keep webview changes compatible with VS Code webview restrictions. Avoid external browser dependencies unless they are intentionally bundled.
- `src/mcp.ts` and `src/tools.ts`: verify tool schemas, enabled tool filtering, and model-facing tool-call formatting.
- `src/sessionManager.ts` and `ai-logs/`: avoid committing generated chat logs unless they are deliberately used as fixtures or examples.

## Coding Guidelines

- Use TypeScript and follow the style already present in `src/`.
- Prefer explicit types for public methods and exported functions.
- Use `const` when a binding is not reassigned.
- Use `GatewayError` from `src/core/llmClient.ts` for LLM gateway failures that should carry user-facing context.
- Log through the existing logger utilities instead of adding new logging systems.
- Keep API keys and tokens out of logs, screenshots, fixtures, and generated output.
- Store credentials only through VS Code `SecretStorage` via `SecretManager`.
- Keep changes focused. Avoid broad refactors when fixing a narrow provider, UI, or configuration issue.

## Documentation Guidelines

Update docs when behavior changes:

- `README.md` for user-facing capabilities, commands, settings, screenshots, or troubleshooting.
- `docs/CONFIGURATION.md` for settings under `private.model.provider.*`.
- `docs/API.md` for internal API or provider behavior.
- `docs/ARCHITECTURE.md` for meaningful component or data-flow changes.
- `docs/PrivateLLM-Provider.md`, `docs/PrivateLLM-Chat.md`, or `docs/PrivateLLM-CLI.md` for mode-specific changes.
- `CHANGELOG.md` for notable user-facing changes.

If you add or rename settings, update both `package.json` contribution metadata and the relevant docs.

## Validation

Run the most targeted checks that cover your change:

```bash
npm run test-compile
npm run esbuild
```

There is currently no dedicated automated test suite or `npm run lint` script in `package.json`. If you add one, document it here and make sure it works in a clean checkout.

For packaging-related changes, also run:

```bash
npm run package
```

Remember that packaging increments the patch version through `prepackage`.

## Manual Test Checklist

Use this checklist for changes that affect runtime behavior:

- [ ] Extension activates cleanly in the Extension Development Host.
- [ ] Status bar shows the expected server state.
- [ ] `Private Model Provider: Test Connection` returns a useful success or error message.
- [ ] Model list loads from `/v1/models`.
- [ ] Default model selection persists.
- [ ] Chat streams responses in the Private Model sidebar.
- [ ] GitHub Copilot Chat can select and use a Private Model Provider model.
- [ ] Tool calling works when `enableToolCalling` is enabled.
- [ ] Parallel tool calls can be disabled for servers that do not support them.
- [ ] MCP tools can be discovered, selected, and sent only when enabled.
- [ ] API keys are stored with SecretStorage and are not logged.
- [ ] Server presets switch the configured endpoint correctly.
- [ ] Session creation, switching, deletion, and title generation behave as expected.
- [ ] Usage statistics update after requests.
- [ ] Error messages are helpful when the server is stopped, misconfigured, or times out.

## Inference Server Notes

When testing server compatibility:

- Do not include `/v1` in `private.model.provider.serverUrl`; the client appends OpenAI-compatible paths.
- LM Studio commonly uses `http://localhost:1234`.
- vLLM commonly uses `http://localhost:8000`.
- If a server fails during tool calls, test with `private.model.provider.parallelToolCalling` disabled, then with `private.model.provider.enableToolCalling` disabled.
- For reasoning models, verify that streamed reasoning fields do not break normal content streaming.

## Pull Requests

1. Create a focused branch.
2. Keep generated files out of the PR unless they are intentionally part of the release.
3. Update docs and screenshots when user-facing behavior changes.
4. Run the relevant validation commands.
5. Include manual test notes in the PR description.

Useful commit types:

- `feat`: new user-facing behavior.
- `fix`: bug fix.
- `docs`: documentation-only change.
- `refactor`: internal restructuring without behavior changes.
- `chore`: build, package, or maintenance change.

Example commits:

```text
feat(provider): add model metadata for LM Studio
fix(client): tolerate final usage chunks in SSE streams
docs(config): document MCP tool settings
```

## Reporting Issues

For bug reports, include:

- VS Code version.
- Extension version.
- Operating system.
- Inference server and version.
- Model name.
- Relevant `private.model.provider.*` settings, excluding secrets.
- Steps to reproduce.
- Expected and actual behavior.
- Relevant output from the `Private LLM` output channel with secrets removed.

For feature requests, describe the workflow you want to support, the server or model involved, and any compatibility constraints.

## Security and Privacy

- Never commit API keys, bearer tokens, private endpoints, or sensitive prompts.
- Scrub `ai-logs/` content before sharing logs or reproduction files.
- Keep requests limited to the configured server URL.
- Treat workspace code and chat history as private user data.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
