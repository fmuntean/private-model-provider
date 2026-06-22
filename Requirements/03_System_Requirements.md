# System Requirements

## Overview
This document outlines the system requirements for the Private Model Provider VS Code extension, including technical specifications, dependencies, and environmental constraints.

---

## SR-001: Development Environment

### SR-001.1: Programming Language
- **Requirement**: The extension must be developed using TypeScript
- **Version**: TypeScript 5.x or compatible
- **Rationale**: TypeScript provides type safety and better developer experience for VS Code extensions

### SR-001.2: Runtime Environment
- **Requirement**: Node.js runtime compatible with VS Code's extension host
- **Version**: Node.js 18.x or later (as bundled with VS Code)
- **Rationale**: VS Code extensions run in Electron's Node.js environment

### SR-001.3: VS Code API
- **Requirement**: Use VS Code Extension API
- **Version**: ^1.100.0
- **Key APIs Used**:
  - `vscode.LanguageModelChatProvider` - For Copilot Chat integration
  - `vscode.WebviewPanel` - For chat interface
  - `vscode.SecretStorage` - For secure API key storage
  - `vscode.Memento` (globalState) - For statistics persistence
  - `vscode.StatusBarItem` - For status bar integration
  - `vscode.EventEmitter` - For internal event system
  - `vscode.CancellationToken` - For request cancellation

**Priority**: High

---

## SR-002: Build and Packaging

### SR-002.1: Bundling
- **Requirement**: Use esbuild for TypeScript compilation and bundling
- **Configuration**: `esbuild.config.mjs` or npm scripts
- **Output**: Single `extension.js` file in `out/` directory
- **Format**: CommonJS (cjs) for VS Code compatibility
- **Target**: ES2020

### SR-002.2: Package Manager
- **Requirement**: npm (Node Package Manager)
- **Lock File**: package-lock.json for reproducible builds

### SR-002.3: Extension Packaging
- **Tool**: vsce (Visual Studio Code Extensions CLI)
- **Command**: `vsce package` or `vsce publish`
- **Output Format**: `.vsix` file

**Priority**: High

---

## SR-003: Dependencies

### SR-003.1: Runtime Dependencies
| Dependency | Version | Purpose |
|------------|----------|---------|
| `vscode` | ^1.100.0 | VS Code Extension API (engine dependency) |

### SR-003.2: Development Dependencies
| Dependency | Version | Purpose |
|------------|----------|---------|
| `@types/vscode` | ^1.100.0 | TypeScript types for VS Code API |
| `typescript` | ^5.0.0 | TypeScript compiler |
| `esbuild` | ^0.20.0 | Bundler and minifier |
| `eslint` | ^8.0.0 or ^9.0.0 | Code linting |
| `@types/node` | ^20.0.0 | Node.js type definitions |

### SR-003.3: External Libraries
- **None required** - The extension uses only Node.js built-in modules:
  - `crypto` (randomUUID, randomBytes)
  - `fs` (file system operations)
  - `path` (path manipulation)
  - `http`/`https` (HTTP requests via `fetch` API)

**Priority**: High

---

## SR-004: Supported Platforms

### SR-004.1: Operating Systems
- **Windows**: Windows 10/11 (x64)
- **macOS**: macOS 12.0+ (x64, arm64)
- **Linux**: Ubuntu 20.04+, Fedora 36+ (x64)

### SR-004.2: VS Code Editions
- **VS Code Desktop**: Full support
- **VS Code Web**: Not supported (requires Node.js APIs)
- **VS Code Insiders**: Should work (compatible API)

**Priority**: High

---

## SR-005: Inference Server Requirements

### SR-005.1: API Compatibility
- **Protocol**: OpenAI Chat Completions API (v1)
- **Endpoint**: `/v1/chat/completions` (POST)
- **Optional Endpoints**:
  - `/v1/models` (GET) - For model discovery
- **Streaming**: Server-Sent Events (SSE) format

### SR-005.2: Supported Servers
| Server | Default URL | Notes |
|--------|-------------|-------|
| vLLM | http://localhost:8000 | Recommended, full feature support |
| Ollama | http://localhost:11434 | Good for local development |
| llama.cpp | http://localhost:8080 | Lightweight option |
| LM Studio | http://localhost:1234 | User-friendly GUI |
| LocalAI | http://localhost:8080 | Open source alternative |
| Text Generation Inference | http://localhost:8080 | Hugging Face optimized |
| Custom | User-defined | Any OpenAI-compatible server |

### SR-005.3: Network Requirements
- **Localhost**: Primary use case (127.0.0.1, localhost)
- **LAN**: Supported (e.g., http://192.168.1.100:8000)
- **TLS/HTTPS**: Supported for remote servers
- **Authentication**: API key via Authorization header or custom header
- **Timeout**: Configurable (`private.model.provider.requestTimeout`, default 30 seconds)

**Priority**: High

---

## SR-006: File System Requirements

### SR-006.1: Workspace Storage
- **Chat Logs**: `<workspace>/.ai-logs/YYYY-MM-DD/HHMM-chatId.jsonl`
- **Session Metadata**: `<workspace>/.ai-logs/sessions.json`
- **Master Prompt**: `<workspace>/.llm/` folder
- **Prompt Templates**: `<workspace>/PromptTemplates/` folder

### SR-006.2: Global Storage (Fallback)
- **Location**: VS Code's globalStorage folder
- **Path**: OS-dependent (via `context.globalStorageUri`)
- **Use Case**: When no workspace is open

### SR-006.3: Permissions
- **Read/Write**: Workspace folder for chat logs and sessions
- **Read/Write**: Extension globalStorage for fallback
- **Read**: Prompt template files
- **No Admin Rights Required**: Extension runs with user privileges

**Priority**: Medium

---

## SR-007: Memory and Performance Constraints

### SR-007.1: Memory Usage
- **Target**: Under 100MB RAM for typical use
- **Session Cache**: Limit in-memory session history (lazy load from disk)
- **Model Cache**: Cache model list with TTL (configurable)
- **Stream Buffer**: Minimal buffering during SSE streaming

### SR-007.2: CPU Usage
- **Idle**: Near 0% CPU when not processing requests
- **Active**: Single-threaded request processing (Node.js event loop)
- **Background**: No background CPU usage except status monitoring

### SR-007.3: Network Usage
- **Model List**: Cached to minimize requests
- **Chat Requests**: Streaming to reduce perceived latency
- **Retry Logic**: Exponential backoff to avoid network flooding

**Priority**: Medium

---

## SR-008: Security Requirements

### SR-008.1: Content Security Policy (Webview)
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               style-src {{cspSource}}; 
               script-src 'nonce-{{nonce}}';">
```

### SR-008.2: Secret Storage
- **API Keys**: Stored in `vscode.SecretStorage` (encrypted)
- **Secret Key**: `private.model.provider.apiKey`
- **Access**: Asynchronous retrieval via `context.secrets.get()`

### SR-008.3: Network Security
- **TLS Verification**: Default Node.js behavior (respects system certificates)
- **Self-Signed Certificates**: Not explicitly supported (user must configure system)
- **CORS**: Not applicable (requests from extension host, not browser)

**Priority**: High

---

## SR-009: Configuration Schema

### SR-009.1: VS Code Settings (contributes.configuration)
```json
{
  "private.model.provider.serverUrl": {
    "type": "string",
    "default": "http://localhost:8000",
    "description": "Base URL of the inference server"
  },
  "private.model.provider.defaultModel": {
    "type": "string",
    "default": "",
    "description": "Default model to use for requests"
  },
  "private.model.provider.enableToolCalling": {
    "type": "boolean",
    "default": true,
    "description": "Enable function/tool calling"
  },
  "private.model.provider.parallelToolCalling": {
    "type": "boolean",
    "default": false,
    "description": "Allow parallel tool execution"
  },
  "private.model.provider.agentTemperature": {
    "type": "number",
    "default": 0.7,
    "description": "Temperature for tool mode"
  },
  "private.model.provider.topP": {
    "type": "number",
    "default": 1.0,
    "description": "Nucleus sampling parameter"
  },
  "private.model.provider.frequencyPenalty": {
    "type": "number",
    "default": 0.0,
    "description": "Reduce token repetition"
  },
  "private.model.provider.presencePenalty": {
    "type": "number",
    "default": 0.0,
    "description": "Encourage new topics"
  },
  "private.model.provider.defaultMaxTokens": {
    "type": "number",
    "default": 131072,
    "description": "Max input tokens (context window)"
  },
  "private.model.provider.defaultMaxOutputTokens": {
    "type": "number",
    "default": 4096,
    "description": "Max output tokens"
  },
  "private.model.provider.requestTimeout": {
    "type": "number",
    "default": 30000,
    "description": "Request timeout in milliseconds"
  },
  "private.model.provider.maxRetries": {
    "type": "number",
    "default": 3,
    "description": "Maximum retry attempts"
  },
  "private.model.provider.retryDelayMs": {
    "type": "number",
    "default": 1000,
    "description": "Base retry delay in milliseconds"
  },
  "private.model.provider.modelCacheTtlMs": {
    "type": "number",
    "default": 300000,
    "description": "Model list cache duration in milliseconds"
  },
  "private.model.provider.logLevel": {
    "type": "string",
    "enum": ["debug", "info", "warn", "error"],
    "default": "info",
    "description": "Logging verbosity level"
  },
  "private.model.provider.showTokenStats": {
    "type": "boolean",
    "default": true,
    "description": "Show token usage in status bar"
  },
  "private.model.provider.systemPrompt": {
    "type": "string",
    "default": "You are a helpful assistant.",
    "description": "Default system prompt for conversations"
  }
}
```

**Priority**: High

---

## SR-010: Commands (contributes.commands)

### SR-010.1: Registered Commands
| Command ID | Title | Description |
|------------|-------|-------------|
| `localModelProvider.sendMessage` | Send Message | Send a message to the LLM |
| `localModelProvider.getStats` | Get Statistics | Retrieve usage statistics |
| `localModelProvider.getSessions` | Get Sessions | List chat sessions |
| `private-model-provider.showStatus` | Show Status | Display server status and options |
| `private-model-provider.setApiKey` | Set API Key | Securely store API key |
| `private-model-provider.clearModelCache` | Clear Model Cache | Force refresh model list |

**Priority**: High

---

## SR-011: Activation Events

### SR-011.1: Extension Activation
- **Event**: `onStartupFinished` - Activate after VS Code startup
- **Alternative**: `*` (any event) for debugging only

### SR-011.2: Language Model Provider
- **Registration**: `vscode.lm.registerLanguageModelChatProvider('private-model-provider', provider)`
- **Namespace**: `private-model-provider` (used in Copilot Chat model picker)

**Priority**: High

---

## SR-012: Output and Logging

### SR-012.1: Output Channel
- **Name**: "Private Model Provider"
- **Access**: `vscode.window.createOutputChannel('Private Model Provider')`
- **Log Format**: `[timestamp] [LEVEL] message`
- **Log Levels**: debug, info, warn, error

### SR-012.2: Log File (Optional)
- **Location**: Not implemented (output channel only)
- **Future**: Could add file-based logging for debugging

**Priority**: Medium

---

## SR-013: Version Control Integration

### SR-013.1: Git Ignore
Recommended `.gitignore` entries:
```
node_modules/
out/
*.vsix
.DS_Store
```

### SR-013.2: Repository Structure
```
private-model-provider/
├── src/              # TypeScript source code
├── docs/             # Documentation
├── assets/           # Images and icons
├── out/              # Compiled JavaScript (gitignored)
├── dist/             # Package output (gitignored)
├── package.json      # npm configuration
├── tsconfig.json     # TypeScript configuration
├── eslint.config.mjs # ESLint configuration
└── README.md         # Project readme
```

**Priority**: Low
