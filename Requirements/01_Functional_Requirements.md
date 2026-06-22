# Functional Requirements

## Overview
This document outlines the functional requirements for the Private Model Provider VS Code extension, which enables developers to connect local LLM inference servers to VS Code for AI-assisted coding.

---

## FR-001: Connect to OpenAI-Compatible Inference Servers

**Description**: The system must connect to any OpenAI Chat Completions-compatible inference server.

**Rationale**: Users run various local LLM servers that implement the OpenAI API standard.

**Acceptance Criteria**:
- Support vLLM, Ollama, llama.cpp, LM Studio, LocalAI, and Text Generation Inference
- Configurable server URL via `private.model.provider.serverUrl` setting
- Support for custom endpoints beyond the predefined list
- Automatic detection of server availability

**Priority**: High

---

## FR-002: Model Discovery and Selection

**Description**: The system must discover available models from the configured inference server and allow users to select which models to use.

**Rationale**: Different models have different capabilities and users need to choose the appropriate model for their tasks.

**Acceptance Criteria**:
- Fetch model list from `/v1/models` endpoint
- Cache model list with configurable TTL (`private.model.provider.modelCacheTtlMs`)
- Allow setting a default model (`private.model.provider.defaultModel`)
- Display available models in VS Code model picker
- Support model switching during chat sessions

**Priority**: High

---

## FR-003: Chat Completion with Streaming

**Description**: The system must support streaming chat completions using the OpenAI Chat Completions API format.

**Rationale**: Streaming provides real-time feedback to users as the model generates responses.

**Acceptance Criteria**:
- Send chat messages in OpenAI format (role, content, tool_calls)
- Stream responses using Server-Sent Events (SSE)
- Support multiple message roles: system, user, assistant, tool
- Handle both streaming and non-streaming response modes
- Properly parse SSE chunks and accumulate response

**Priority**: High

---

## FR-004: Function/Tool Calling Support

**Description**: The system must support function calling (tool use) to enable AI agents to interact with VS Code tools.

**Rationale**: Modern AI coding assistants need to execute tools for tasks like file operations, code analysis, and more.

**Acceptance Criteria**:
- Convert VS Code LanguageModelTool definitions to OpenAI function format
- Support parallel tool calling (`private.model.provider.parallelToolCalling`)
- Parse tool call responses from streaming responses
- Repair malformed JSON in tool call arguments
- Fill missing required properties in tool calls
- Report tool call results back to the model
- Support multiple tool call formats (tool_calls, function_call)

**Priority**: High

---

## FR-005: Token Management and Budgeting

**Description**: The system must manage token usage to stay within model context limits and provide usage feedback.

**Rationale**: LLMs have fixed context windows; exceeding these limits causes errors or truncated responses.

**Acceptance Criteria**:
- Estimate token count for messages (`provideTokenCount`)
- Truncate conversation history to fit context window
- Track token usage per request (prompt, completion, total)
- Categorize tokens by type (prompt, context, user, agent, tools)
- Respect `private.model.provider.defaultMaxTokens` (input) and `defaultMaxOutputTokens` (output)
- Provide token usage statistics to users

**Priority**: High

---

## FR-006: Secure API Key Management

**Description**: The system must securely store and manage API keys for authentication with inference servers.

**Rationale**: API keys are sensitive credentials that must not be stored in plain text.

**Acceptance Criteria**:
- Store API keys in VS Code SecretStorage (encrypted)
- Retrieve API keys transparently during requests
- Support migration from legacy settings-based storage
- Clear API key from settings after migration
- React to secret storage changes in real-time
- Provide commands to set, view, and delete API keys

**Priority**: High

---

## FR-007: Server Presets for Quick Configuration

**Description**: The system must provide predefined server presets for common inference servers.

**Rationale**: Users should be able to quickly switch between different local LLM setups.

**Acceptance Criteria**:
- Provide presets for vLLM, Ollama, llama.cpp, LM Studio
- Allow custom preset creation
- Quick switching between presets
- Presets include default URL and optional API key
- Status bar integration for preset selection

**Priority**: Medium

---

## FR-008: Chat Session Management

**Description**: The system must manage multiple chat sessions with persistence.

**Rationale**: Users need to maintain separate conversations for different tasks and refer back to previous discussions.

**Acceptance Criteria**:
- Create new chat sessions
- Switch between active sessions
- Persist sessions to disk (`ai-logs/sessions.json`)
- Store session metadata (title, created date, model used)
- Save chat history in JSONL format (`ai-logs/YYYY-MM-DD/HHMM-chatId.jsonl`)
- Load previous sessions on startup
- Delete sessions
- Auto-generate session titles from first message

**Priority**: Medium

---

## FR-009: Conversation History Export/Import

**Description**: The system must allow users to export and import conversation histories.

**Rationale**: Users may want to share conversations, backup discussions, or transfer them between environments.

**Acceptance Criteria**:
- Export conversation to JSON format
- Import previously exported conversations
- Preserve message roles and content
- Preserve tool call information
- Validate imported data format

**Priority**: Low

---

## FR-010: Master/Prompt Template Support

**Description**: The system must support customizable system prompts and prompt templates with advanced configuration.

**Rationale**: Different tasks require different system prompts to guide model behavior effectively. Advanced configuration allows per-model and per-role customization.

**Acceptance Criteria**:
- Configurable default system prompt (`private.model.provider.systemPrompt`)
- Support for system prompt file in `.llm/` folder
- Allow editing system prompt per session
- Support PromptTemplates folder for reusable templates
- Load `SystemPrompt.md` from `PromptTemplates/` folder
- Support YAML configuration for model roles (chat, edit, apply, summarize)
- Support model-specific prompt templates (e.g., llama3, anthropic)
- Configure base system messages for chat, agent, and plan modes
- Support importing prompts from URL or local files
- Override default templates per model configuration

**Priority**: Medium

---

## FR-011: Statistics Tracking

**Description**: The system must track and display usage statistics for monitoring and analysis.

**Rationale**: Users need visibility into token usage, request counts, and performance metrics.

**Acceptance Criteria**:
- Track total requests, input tokens, output tokens
- Calculate average response time
- Categorize token usage by message type
- Persist statistics in globalState
- Display statistics in status bar
- Provide per-model statistics
- Track session-specific statistics

**Priority**: Medium

---

## FR-012: Status Bar Integration

**Description**: The system must provide server status and quick actions via the VS Code status bar.

**Rationale**: Users need at-a-glance information about server connectivity and quick access to common actions.

**Acceptance Criteria**:
- Show server connection status (connected, error, unknown)
- Display model count when connected
- Show token usage badge (optional, `private.model.provider.showTokenStats`)
- Quick access to server presets
- Quick access to model selection
- Color-coded status indicators
- Tooltip with detailed status information

**Priority**: Medium

---

## FR-013: Webview-Based Chat Interface

**Description**: The system must provide a chat interface via VS Code webview.

**Rationale**: Users need a dedicated UI for interacting with the local LLM beyond the Copilot Chat integration.

**Acceptance Criteria**:
- Create webview panel for chat interface
- Support dark/light theme matching VS Code
- Display conversation history
- Input area for user messages
- Send/Stop buttons for controlling generation
- Model selector dropdown
- Session list with navigation
- Real-time message streaming in UI
- Error display for failed requests

**Priority**: Medium

---

## FR-014: Configuration Management

**Description**: The system must provide comprehensive configuration options via VS Code settings.

**Rationale**: Users have different inference servers, models, and preferences that need customization.

**Acceptance Criteria**:
- Server URL configuration
- Model selection settings
- Temperature, top_p, frequency/presence penalty settings
- Token limits (input and output)
- Tool calling enable/disable and parallel execution
- Retry configuration (max retries, delay)
- Logging level configuration
- Model cache TTL
- All settings readable at runtime with hot-reload

**Priority**: High

---

## FR-015: Retry Logic with Exponential Backoff

**Description**: The system must implement retry logic for transient failures when calling the inference server.

**Rationale**: Network issues, rate limits, and temporary server errors should be handled gracefully.

**Acceptance Criteria**:
- Retry on retryable status codes (429, 500, 502, 503, 504)
- Exponential backoff with jitter
- Configurable max retries (`private.model.provider.maxRetries`)
- Configurable base delay (`private.model.provider.retryDelayMs`)
- Maximum delay cap to prevent excessive waits
- Log retry attempts for debugging

**Priority**: Medium

---

## FR-016: Logging and Debugging Support

**Description**: The system must provide comprehensive logging for debugging and monitoring.

**Rationale**: Users and developers need visibility into extension behavior for troubleshooting.

**Acceptance Criteria**:
- Configurable log levels (debug, info, warn, error)
- Output channel for log display
- Timestamp and log level in each entry
- Log API requests and responses
- Log token usage and performance metrics
- Log retry attempts and failures
- Log configuration changes

**Priority**: Medium

---

## FR-017: Multi-Model Support in Chat

**Description**: The system must allow using different models for different chat sessions or within the same session.

**Rationale**: Users may want to compare model outputs or use specialized models for specific tasks.

**Acceptance Criteria**:
- Track which model generated each message
- Allow model switching per session
- Display model information with each response
- Support model override for individual requests
- Persist model selection with session

**Priority**: Low

---

## FR-018: Reasoning/Thinking Content Support

**Description**: The system must support models that provide reasoning or thinking content alongside responses.

**Rationale**: Advanced models like OpenAI o1/o3 provide reasoning traces that users may want to see.

**Acceptance Criteria**:
- Parse `reasoning_content` field (OpenAI o1/o3 format)
- Parse `reasoning` field (alternative format)
- Parse `thinking` field (Anthropic format)
- Display reasoning content in webview
- Option to show/hide reasoning content

**Priority**: Low

---

## FR-019: Event System for Internal Communication

**Description**: The system must use an event-based architecture for internal component communication.

**Rationale**: Loose coupling between components improves maintainability and extensibility.

**Acceptance Criteria**:
- Event emitter for statistics updates
- Event emitter for session changes
- Event emitter for model list changes
- Event emitter for configuration changes
- Subscribers receive relevant data with each event

**Priority**: Medium

---

## FR-020: Workspace Integration

**Description**: The system must integrate with VS Code workspace for file operations and context.

**Rationale**: The extension should respect workspace boundaries and use workspace storage appropriately.

**Acceptance Criteria**:
- Use workspace folder for chat logs (`ai-logs/`)
- Use workspace folder for session metadata
- Use workspace folder for prompt templates (`.llm/`, `PromptTemplates/`)
- Fallback to globalStorage when no workspace is open
- Respect workspace trust settings

**Priority**: Medium

---

## FR-021: MCP Server Integration

**Description**: The system must support Model Context Protocol (MCP) servers for extending available tools.

**Rationale**: MCP is becoming a standard for AI tool integration, allowing third-party tools to be used with any MCP-compatible AI system.

**Acceptance Criteria**:
- Support configuring MCP servers via settings
- Support stdio and SSE transport types
- Integrate MCP tools into the tool calling flow
- Parse MCP tool definitions and convert to OpenAI format
- Handle MCP tool execution and result reporting
- Support MCP server lifecycle management (start, stop, restart)
- Allow enabling/disabling individual MCP servers

**Priority**: High

---

## FR-022: Inline Code Suggestions

**Description**: The system must provide inline code completions as the user types.

**Rationale**: Developers expect AI assistance directly in the editor, not just in a chat panel.

**Acceptance Criteria**:
- Implement `InlineCompletionItemProvider` API
- Provide single-line and multi-line suggestions
- Debounce requests to avoid excessive API calls
- Include editor context (prefix, suffix, language, filename)
- Support tab-to-accept completion
- Configure suggestion delay and context window
- Show ghost text for suggestions

**Priority**: High

---

## FR-023: Inline Chat

**Description**: The system must support opening a chat prompt directly in the editor for targeted changes.

**Rationale**: Developers want to describe changes without leaving the editor context.

**Acceptance Criteria**:
- Trigger inline chat with keyboard shortcut (e.g., Ctrl+I)
- Show chat prompt inline or in floating widget
- Apply suggested edits directly to the editor
- Maintain editor context (selected code, cursor position)
- Support quick refactors and explanations
- Dismiss without applying changes

**Priority**: Medium

---

## FR-024: Tab Autocomplete

**Description**: The system must provide tab-based code completions with configurable behavior.

**Rationale**: Tab completion is a fast way to accept AI suggestions without leaving the keyboard flow.

**Acceptance Criteria**:
- Configure model-specific autocomplete options
- Support prefix/suffix context allocation
- Include recently edited/opened files as context
- Configure debounce delay and timeout
- Support stop words and custom templates
- Enable/disable autocomplete per model
- Use cache for improved performance

**Priority**: Medium

---

## FR-025: Context Providers

**Description**: The system must support additional context sources beyond chat history.

**Rationale**: Providing relevant context (files, docs, terminal output) improves response quality.

**Acceptance Criteria**:
- Support file context provider (include specific files)
- Support code context provider (surrounding code)
- Support diff context provider (git changes)
- Support HTTP/URL context provider (fetch web content)
- Support terminal output context
- Allow configuring context providers per request
- Document context provider configuration

**Priority**: Medium

---

## FR-026: Rules System

**Description**: The system must support project-wide rules that are included in system messages.

**Rationale**: Rules enforce coding conventions and guide model behavior consistently.

**Acceptance Criteria**:
- Define rules in configuration or rules files
- Concatenate rules into system message
- Support local rules files (`.llm/rules.md`)
- Support remote rules (URL reference)
- Apply rules to chat, edit, and agent requests
- Allow disabling rules temporarily
- Support multiple rule sets for different purposes

**Priority**: Medium

---

## FR-027: Prompt Commands

**Description**: The system must support reusable prompt templates invoked via `/command` syntax.

**Rationale**: Users need quick access to common prompts without retyping them.

**Acceptance Criteria**:
- Define prompts with `/command` syntax
- Support parameterized prompts (variables)
- Store prompts in workspace or remote location
- Invoke prompts from chat interface
- Support prompt descriptions for discoverability
- Allow prompt overrides for specific use cases
- Document prompt creation process

**Priority**: Low

---

## FR-028: Agent Mode (Autonomous)

**Description**: The system must support autonomous agent mode for end-to-end task completion.

**Rationale**: Developers want AI that can plan, execute, and self-correct to complete coding tasks.

**Acceptance Criteria**:
- Break high-level tasks into step-by-step plans
- Edit multiple files across the project
- Run commands and tests
- Self-correct when errors occur
- Provide progress updates during execution
- Support handoff to other agents
- Maintain task context throughout execution

**Priority**: Low

---

## FR-029: Plan Mode

**Description**: The system must support a planning phase before executing code changes.

**Rationale**: Planning helps ensure the agent understands the task and approach before making changes.

**Acceptance Criteria**:
- Analyze codebase before proposing plan
- Ask clarifying questions when needed
- Produce structured implementation plan
- Allow user to review and modify plan
- Hand off approved plan to implementation agent
- Track plan vs. actual implementation

**Priority**: Low

---

## FR-030: Documentation Indexing

**Description**: The system must support indexing documentation sites for context-aware responses.

**Rationale**: Developers often need help with libraries/frameworks; indexed docs provide accurate context.

**Acceptance Criteria**:
- Configure documentation sites to index (URL, favicon)
- Crawl documentation pages starting from root
- Support local documentation crawling
- Use indexed docs as context for relevant queries
- Update indexed content periodically
- Show documentation sources in responses

**Priority**: Low

---

## FR-031: Small Model for Summarization and Title Generation

**Description**: The system must support a dedicated small model for lightweight tasks such as summarization and session title generation.

**Rationale**: Using a smaller, faster model for summarization and title generation reduces latency and resource usage compared to using the main chat model for these auxiliary tasks.

**Acceptance Criteria**:
- Add new setting `private.model.provider.smallModel` to configure a small model for summarization tasks
- Modify the session creation flow to use the small model for generating session titles
- When a new session starts with the first message, automatically generate a title using the small model
- Use a 10-word summary prompt to generate concise session titles
- Support custom summary prompt template via `.llm/session.summary.md` file in the current workspace
- If `.llm/session.summary.md` exists in the workspace, use it as the summary prompt template instead of the default
- Fall back to the default model if no small model is configured
- The summary prompt should request a concise title (approximately 10 words) based on the first user message
- Store the generated title with the session metadata
- Display the generated title in the session list/view

**Priority**: Medium
