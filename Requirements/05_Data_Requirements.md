# Data Requirements

## Overview
This document outlines the data requirements for the Private Model Provider VS Code extension, including data models, storage formats, and data flow.

---

## DR-001: Configuration Data

### DR-001.1: Gateway Configuration
**Storage**: VS Code settings (`settings.json`) and SecretStorage

**Schema**:
```typescript
interface GatewayConfig {
  serverUrl: string;                    // Inference server URL
  apiKey?: string;                      // From SecretStorage (not settings)
  requestTimeout: number;               // Request timeout in ms (default: 30000)
  defaultMaxTokens: number;             // Max input tokens (default: 131072)
  defaultMaxOutputTokens: number;       // Max output tokens (default: 4096)
  enableToolCalling: boolean;           // Enable function calling (default: true)
  parallelToolCalling: boolean;         // Allow parallel tool calls (default: false)
  agentTemperature: number;             // Temperature for tool mode (default: 0.7)
  topP: number;                         // Nucleus sampling (default: 1.0)
  frequencyPenalty: number;             // Reduce repetition (default: 0.0)
  presencePenalty: number;              // Encourage new topics (default: 0.0)
  maxRetries: number;                   // Max retry attempts (default: 3)
  retryDelayMs: number;                 // Base retry delay (default: 1000)
  modelCacheTtlMs: number;              // Model cache TTL (default: 300000)
  logLevel: 'debug' | 'info' | 'warn' | 'error';  // Log level (default: 'info')
  defaultModel: string;                 // Default model ID (default: '')
  showTokenStats: boolean;              // Show token badge (default: true)
  systemPrompt: string;                 // Default system prompt
}
```

**Persistence**:
- Settings: Persisted in VS Code `settings.json` (user or workspace)
- API Key: Persisted in VS Code `SecretStorage` (encrypted)

**Lifecycle**: Loaded on activation, hot-reloaded on change

**Priority**: High

---

## DR-002: Model Data

### DR-002.1: Model Information
**Storage**: In-memory cache (with TTL), fetched from server

**Schema**:
```typescript
interface OpenAIModel {
  id: string;              // Model identifier (e.g., "gpt-oss-120b")
  object: string;          // Always "model"
  created: number;         // Unix timestamp of model creation
  owned_by: string;        // Organization that owns the model
}

interface OpenAIModelsResponse {
  object: string;          // Always "list"
  data: OpenAIModel[];     // Array of available models
}
```

**Persistence**:
- Cache in memory with TTL (`modelCacheTtlMs`)
- Not persisted to disk (re-fetch on cache expiry)

**Lifecycle**: Fetched on first use, cached, cleared on config change or manual refresh

**Priority**: High

---

## DR-003: Chat Session Data

### DR-003.1: Session Metadata
**Storage**: `<workspace>/.ai-logs/sessions.json`

**Schema**:
```typescript
interface ChatSessionMetadata {
  id: string;              // Unique session ID (UUID)
  title: string;           // Human-readable title (from first message)
  createdAt: string;       // ISO 8601 timestamp
  updatedAt: string;       // ISO 8601 timestamp
  modelId: string;         // Default model for this session
  lastUsedModel?: string;  // Last model used in session
  messageCount: number;    // Total messages in session
  tokenUsage: SessionTokenUsage;  // Token usage stats
}

interface SessionTokenUsage {
  byType: TokenUsageByType;
  total: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

interface TokenUsageByType {
  prompt: number;          // System prompt tokens
  context: number;         // Context/files tokens
  user: number;            // User message tokens
  agent: number;           // Assistant response tokens
  tools: number;           // Tool call/result tokens
}
```

**Persistence**: JSON file, written on session update

**Lifecycle**: Created on new session, updated on each message, deleted on session delete

**Priority**: High

---

### DR-003.2: Session Messages
**Storage**: `<workspace>/.ai-logs/YYYY-MM-DD/HHMM-chatId.jsonl`

**Schema** (one JSON object per line):
```typescript
interface ChatSessionMessage {
  id: string;                          // Unique message ID
  type: ChatMessageType;               // 'prompt' | 'context' | 'user' | 'agent' | 'tools'
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;                      // Message content
  timestamp: string;                    // ISO 8601 timestamp
  modelId?: string;                     // Model that generated (for assistant)
  tokenEstimate?: number;               // Estimated token count
  toolCalls?: Array<{                   // For assistant messages with tool calls
    id: string;
    name: string;
    arguments: string;
  }>;
  toolCallId?: string;                  // For tool result messages
}

type ChatMessageType = 'prompt' | 'context' | 'user' | 'agent' | 'tools';
```

**Persistence**: JSONL (JSON Lines) format, append-only

**Lifecycle**: Created with session, appended on each message

**Priority**: High

---

### DR-003.3: Full Session Object
```typescript
interface ChatSession extends ChatSessionMetadata {
  messages: ChatSessionMessage[];      // Loaded from JSONL on demand
}
```

**Note**: Messages are lazy-loaded from JSONL file when session is accessed

**Priority**: High

---

## DR-004: Statistics Data

### DR-004.1: Request Statistics
**Storage**: In-memory, optionally persisted to VS Code `globalState`

**Schema**:
```typescript
interface RequestStats {
  modelId: string;                     // Model used
  inputTokens: number;                  // Prompt tokens
  outputTokens: number;                 // Completion tokens
  responseTimeMs: number;              // Response time in milliseconds
  timestamp: Date;                      // When request completed
  messageType?: keyof TokenUsageByType; // Type of message
}

interface SessionStats {
  totalRequests: number;               // Total requests in session
  totalInputTokens: number;             // Sum of input tokens
  totalOutputTokens: number;            // Sum of output tokens
  averageResponseTimeMs: number;        // Average response time
  lastResponseTimeMs: number;           // Most recent response time
  sessionStartTime: Date;               // When stats started
  tokenUsageByType: TokenUsageByType;   // Tokens by message type
}
```

**Persistence**:
- In-memory during session
- Optionally persisted to `globalState` for cross-session stats

**Lifecycle**: Reset on manual reset, persists across restarts if saved

**Priority**: Medium

---

## DR-005: API Request/Response Data

### DR-005.1: OpenAI Chat Completion Request
**Storage**: Transient (sent to server, not stored)

**Schema**:
```typescript
interface OpenAIChatCompletionRequest {
  model: string;                        // Model ID
  messages: OpenAIMessage[];            // Conversation history
  temperature?: number;                 // Sampling temperature
  max_tokens?: number;                  // Max output tokens
  stream?: boolean;                     // Enable streaming
  top_p?: number;                       // Nucleus sampling
  frequency_penalty?: number;           // Reduce repetition
  presence_penalty?: number;            // Encourage new topics
  tools?: OpenAITool[];                 // Available tools
  tool_choice?: 'auto' | 'none' | object;  // Tool selection
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];        // For assistant messages
  tool_call_id?: string;                // For tool messages
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: object;                // JSON Schema
  };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;                  // JSON string
  };
}
```

**Priority**: High

---

### DR-005.2: OpenAI Chat Completion Response (Streaming)
**Storage**: Transient (processed and displayed)

**Schema** (SSE chunk):
```typescript
interface OpenAIChatCompletionChunk {
  id: string;                           // Request ID
  object: string;                       // "chat.completion.chunk"
  created: number;                      // Unix timestamp
  model: string;                        // Model used
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: OpenAIToolCallDelta[];
      reasoning_content?: string;        // o1/o3 format
      reasoning?: string;               // Alternative format
      thinking?: string;                // Anthropic format
    };
    finish_reason: string | null;
  }>;
}

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}
```

**Priority**: High

---

### DR-005.3: OpenAI Chat Completion Response (Non-Streaming)
**Storage**: Transient (processed and displayed)

**Schema**:
```typescript
interface OpenAIChatCompletionResponse {
  id: string;
  object: string;                       // "chat.completion"
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

**Priority**: High

---

## DR-006: Server Presets Data

### DR-006.1: Preset Configuration
**Storage**: In-memory (hardcoded in `statusBar.ts`)

**Schema**:
```typescript
interface ServerPreset {
  name: string;                         // Display name (e.g., "vLLM")
  url: string;                          // Default URL
  apiKey?: string;                       // Optional default API key
}
```

**Default Presets**:
| Name | URL | Notes |
|------|-----|-------|
| vLLM | http://localhost:8000 | Recommended |
| Ollama | http://localhost:11434 | Local development |
| llama.cpp | http://localhost:8080 | Lightweight |
| LM Studio | http://localhost:1234 | GUI-based |
| Custom | User-defined | Any compatible server |

**Persistence**: Not persisted (defined in code)

**Priority**: Medium

---

## DR-007: Webview State Data

### DR-007.1: Chat Webview State
**Storage**: In-memory (webview state)

**Schema** (messages from webview to extension):
```typescript
// Webview to Extension
interface WebviewMessage {
  command: string;                      // 'sendMessage' | 'getModels' | 'getSessions' | etc.
  text?: string;                        // Message text
  model?: string;                       // Selected model
  sessionId?: string;                   // Current session ID
  // ... other properties
}

// Extension to Webview
interface ExtensionMessage {
  type: string;                         // 'assistant' | 'error' | 'models' | 'sessions' | etc.
  content?: string;                      // Message content
  usage?: object;                       // Token usage
  sessionId?: string;                   // Session ID
  // ... other properties
}
```

**Persistence**: Transient (lost on webview close)

**Priority**: Medium

---

## DR-008: Prompt Template Data

### DR-008.1: System Prompt
**Storage**: Settings or file

**Sources** (in order of precedence):
1. Session-specific system prompt (webview editor)
2. Workspace file: `<workspace>/.llm/system-prompt.md`
3. Settings: `private.model.provider.systemPrompt`
4. Default: "You are a helpful assistant."

**Schema**: Plain text (Markdown supported)

**Persistence**: File or settings

**Priority**: Medium

---

### DR-008.2: Prompt Templates
**Storage**: `<workspace>/PromptTemplates/`

**Schema**: Markdown files (e.g., `SystemPrompt.md`)

**Usage**: Loaded by webview for template selection

**Persistence**: File system

**Priority**: Low

---

## DR-009: Logging Data

### DR-009.1: Log Entries
**Storage**: VS Code Output Channel

**Schema**:
```
[timestamp] [LEVEL] message
```

Example:
```
[2026-05-07T10:30:00.000Z] [INFO ] Model list fetched: 5 models
[2026-05-07T10:30:01.000Z] [DEBUG] Sending request to http://localhost:8000/v1/chat/completions
```

**Persistence**: Output channel (volatile, not saved to disk)

**Priority**: Medium

---

## DR-010: MCP Server Configuration

### DR-010.1: MCP Server Config
**Storage**: VS Code settings (`settings.json`)

**Schema**:
```typescript
interface MCPServerConfig {
  name: string;                         // Display name
  command?: string;                      // Command to start server (stdio)
  args?: string[];                       // Arguments for command
  env?: Record<string, string>;         // Environment variables
  cwd?: string;                         // Working directory
  url?: string;                          // URL for SSE/HTTP servers
  transportType: 'stdio' | 'sse' | 'streamable-http';
  connectionTimeout?: number;             // Connection timeout ms
  requestOptions?: {
    timeout?: number;
    headers?: Record<string, string>;
    verifySsl?: boolean;
  };
}
```

**Persistence**: `settings.json` (user or workspace)

**Lifecycle**: Loaded on activation, can be changed at runtime

**Priority**: High

---

## DR-011: Rules Data

### DR-011.1: Rules Configuration
**Storage**: Settings or files

**Sources** (in order of precedence):
1. Workspace file: `<workspace>/.llm/rules.md`
2. Settings array: `private.model.provider.rules`
3. Remote URL reference

**Schema**:
```typescript
interface Rule {
  name?: string;                         // Optional rule name
  content: string;                        // Rule text
  source?: string;                        // File path or URL
}
```

**Persistence**: File or settings

**Priority**: Medium

---

## DR-012: Prompt Commands Data

### DR-012.1: Prompt Command Definition
**Storage**: Workspace files or settings

**Schema**:
```typescript
interface PromptCommand {
  name: string;                          // Command name (without /)
  description?: string;                    // Help text
  content: string;                        // Prompt template
  invokeable: boolean;                    // Show in command list
  parameters?: Array<{
    name: string;
    description?: string;
    defaultValue?: string;
  }>;
}
```

**Persistence**: `PromptTemplates/` folder or settings

**Priority**: Low

---

## DR-013: Autocomplete Configuration

### DR-013.1: Autocomplete Settings
**Storage**: VS Code settings

**Schema**:
```typescript
interface AutocompleteConfig {
  disabled: boolean;                      // Disable autocomplete
  maxPromptTokens: number;                // Max context tokens
  debounceDelay: number;                  // Delay before trigger
  modelTimeout: number;                   // Model timeout ms
  maxSuffixPercentage: number;            // Suffix context %
  prefixPercentage: number;               // Prefix context %
  transform: boolean;                      // Apply transformations
  template?: string;                      // Mustache template
  onlyMyCode: boolean;                    // Only include repo code
  useCache: boolean;                      // Enable caching
  useImports: boolean;                    // Include imports
  useRecentlyEdited: boolean;             // Include recent edits
  useRecentlyOpened: boolean;             // Include recent files
}
```

**Persistence**: Model-specific settings in config

**Priority**: Medium

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     User Input (Webview)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Extension (GatewayProvider)                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Config Data  │───▶│Session Data │───▶│ Statistics   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              GatewayClient (HTTP Request)                   │
│  ┌──────────────┐    ┌──────────────┐                      │
│  │ Model Data   │◀───│ Request/Resp │                      │
│  └──────────────┘    └──────────────┘                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Inference Server (External)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Retention Policy

| Data Type | Retention | Cleanup |
|-----------|-----------|---------|
| Configuration | Until changed | Manual |
| Model Cache | TTL (default 5 min) | Auto on expiry or config change |
| Session Metadata | Indefinite | Manual delete |
| Session Messages | Indefinite | Manual delete or workspace clean |
| Statistics | Indefinite | Manual reset |
| API Keys | Until deleted | Manual or command |
| Logs | Session only | Lost on Output channel close |

**Priority**: Medium
