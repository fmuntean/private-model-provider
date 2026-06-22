# User Stories

## Overview
This document captures user stories for the Private Model Provider VS Code extension, organized by user personas and feature areas.

---

## Personas

### Persona 1: Developer Dave (Primary User)
- **Role**: Software Developer
- **Goal**: Use local LLMs for coding assistance while keeping code private
- **Needs**: Easy setup, reliable performance, integration with VS Code Copilot Chat

### Persona 2: Data Scientist Dana
- **Role**: Data Scientist/ML Engineer
- **Goal**: Experiment with different Private Models for code generation
- **Needs**: Model switching, token tracking, session management

### Persona 3: Privacy-Conscious Patricia
- **Role**: Security-conscious Developer
- **Goal**: Ensure no code leaves local infrastructure
- **Needs**: Local-only processing, secure credential storage, no telemetry

### Persona 4: Power User Pete
- **Role**: Senior Developer/Extension Contributor
- **Goal**: Customize and extend the extension for specific workflows
- **Needs**: Comprehensive configuration, debugging tools, clear architecture

---

## Epic 1: Getting Started

### US-001: Install Extension
**As a** Developer Dave  
**I want to** install the Private Model Provider extension from the VS Code Marketplace  
**So that** I can start using local LLMs in VS Code

**Acceptance Criteria**:
- Extension appears in VS Code Marketplace search
- One-click install from Marketplace
- Extension activates without errors after install
- No additional setup required for activation

**Priority**: High

---

### US-002: Start Local Inference Server
**As a** Developer Dave  
**I want to** start a local LLM inference server (e.g., vLLM, Ollama)  
**So that** the extension can connect to it

**Acceptance Criteria**:
- Documentation provides examples for popular servers
- Quick start guide covers vLLM, Ollama, LM Studio
- Server URL examples for each server type
- Troubleshooting tips for common server issues

**Priority**: High

---

### US-003: Configure Server URL
**As a** Developer Dave  
**I want to** set the inference server URL in VS Code settings  
**So that** the extension knows where to send requests

**Acceptance Criteria**:
- Setting `private.model.provider.serverUrl` is available in settings UI
- Can use command palette to configure (future enhancement)
- Validation of URL format
- Default value points to common local server

**Priority**: High

---

### US-004: Select Default Model
**As a** Data Scientist Dana  
**I want to** choose which model to use for chat completions  
**So that** I can use the best model for my current task

**Acceptance Criteria**:
- Model picker shows available models from server
- Can set default model in settings
- Model selection persists across sessions
- Can switch models during chat

**Priority**: High

---

## Epic 2: Chat and Code Assistance

### US-005: Send Chat Message
**As a** Developer Dave  
**I want to** send a message to the local LLM via Copilot Chat or webview  
**So that** I can get AI assistance with coding tasks

**Acceptance Criteria**:
- Message appears in chat interface immediately
- Response streams in real-time
- Can see which model generated the response
- Error messages are clear and actionable

**Priority**: High

---

### US-006: View Streaming Response
**As a** Developer Dave  
**I want to** see the LLM response as it's being generated  
**So that** I get immediate feedback and can start reading early

**Acceptance Criteria**:
- First token appears within 3 seconds for local servers
- Text appears incrementally (not all at once)
- Streaming works in both Copilot Chat and webview
- Can stop generation mid-stream

**Priority**: High

---

### US-007: Use Tool/Function Calling
**As a** Developer Dave  
**I want to** have the LLM call tools (e.g., read file, run command)  
**So that** it can perform actions beyond text generation

**Acceptance Criteria**:
- Tools appear in requests to the LLM
- LLM can invoke tools and get results
- Tool results are sent back to LLM for follow-up
- Tool call errors are handled gracefully

**Priority**: High

---

### US-008: Set System Prompt
**As a** Power User Pete  
**I want to** customize the system prompt for the conversation  
**So that** I can guide the LLM's behavior for specific tasks

**Acceptance Criteria**:
- Default system prompt in settings
- Can edit system prompt per session (webview)
- System prompt file support (`.llm/` folder)
- Prompt templates in `PromptTemplates/` folder

**Priority**: Medium

---

### US-009: View Token Usage
**As a** Data Scientist Dana  
**I want to** see how many tokens my requests are using  
**So that** I can manage my context window and understand costs

**Acceptance Criteria**:
- Token count displayed in status bar (optional)
- Detailed token stats available (prompt, completion, total)
- Token usage by message type (user, agent, tools)
- Statistics persist across sessions

**Priority**: Medium

---

## Epic 3: Session Management

### US-010: Create New Chat Session
**As a** Data Scientist Dana  
**I want to** start a new chat session  
**So that** I can separate different topics or tasks

**Acceptance Criteria**:
- "New Chat" button in webview
- Session gets auto-generated title from first message
- Can create unlimited sessions
- New session starts with empty context

**Priority**: Medium

---

### US-011: Switch Between Sessions
**As a** Data Scientist Dana  
**I want to** switch between different chat sessions  
**So that** I can refer back to previous conversations

**Acceptance Criteria**:
- Session list view in webview
- Click session to switch to it
- Active session is highlighted
- Switching loads previous messages

**Priority**: Medium

---

### US-012: Export Conversation
**As a** Developer Dave  
**I want to** export a chat session to a file  
**So that** I can share it or save it externally

**Acceptance Criteria**:
- Export button in webview
- Saves to JSON format
- Includes all messages and tool calls
- Can choose save location

**Priority**: Low

---

### US-013: Import Conversation
**As a** Developer Dave  
**I want to** import a previously exported conversation  
**So that** I can continue a discussion or review it

**Acceptance Criteria**:
- Import button in webview
- Validates imported file format
- Loads messages into current session
- Preserves message roles and content

**Priority**: Low

---

## Epic 4: Configuration and Customization

### US-014: Adjust Temperature
**As a** Data Scientist Dana  
**I want to** adjust the temperature parameter  
**So that** I can control randomness in LLM responses

**Acceptance Criteria**:
- Temperature setting in VS Code settings
- Range: 0.0 to 2.0
- Changes take effect on next request
- Can set different temperatures for different modes

**Priority**: Medium

---

### US-015: Configure Token Limits
**As a** Power User Pete  
**I want to** set maximum input and output token limits  
**So that** I can optimize for my model's context window

**Acceptance Criteria**:
- `defaultMaxTokens` for input context window
- `defaultMaxOutputTokens` for response length
- Validation of reasonable values
- Warning if limits exceed model capabilities

**Priority**: Medium

---

### US-016: Enable/Disable Tool Calling
**As a** Developer Dave  
**I want to** turn tool calling on or off  
**So that** I can troubleshoot issues or simplify requests

**Acceptance Criteria**:
- Toggle in settings UI
- Changes take effect immediately
- Clear indication when tool calling is disabled
- Models that don't support tools work without errors

**Priority**: Medium

---

### US-017: Set Up Server Presets
**As a** Developer Dave  
**I want to** quickly switch between different server configurations  
**So that** I can test different local LLM setups

**Acceptance Criteria**:
- Presets for vLLM, Ollama, llama.cpp, LM Studio
- One-click switching via status bar
- Custom presets can be added
- Presets include URL and optional API key

**Priority**: Medium

---

### US-018: Secure API Key Storage
**As a** Privacy-Conscious Patricia  
**I want to** store my API key securely  
**So that** it's not exposed in plain text settings files

**Acceptance Criteria**:
- API key stored in VS Code SecretStorage
- Command to set API key securely
- No API key in settings.json
- Migration from legacy settings-based storage

**Priority**: High

---

## Epic 5: Monitoring and Debugging

### US-019: View Server Status
**As a** Developer Dave  
**I want to** see if the inference server is reachable  
**So that** I know why requests might be failing

**Acceptance Criteria**:
- Status bar icon shows connection state
- Color-coded status (green=connected, red=error)
- Tooltip shows server URL and model count
- Click for more details and actions

**Priority**: Medium

---

### US-020: View Statistics
**As a** Data Scientist Dana  
**I want to** see usage statistics for my LLM requests  
**So that** I can analyze my usage patterns

**Acceptance Criteria**:
- Total requests, tokens, average response time
- Statistics by model
- Per-session statistics
- Reset statistics option

**Priority**: Medium

---

### US-021: Debug with Logs
**As a** Power User Pete  
**I want to** see detailed logs of extension activity  
**So that** I can troubleshoot issues

**Acceptance Criteria**:
- Output channel "Private Model Provider"
- Configurable log level (debug, info, warn, error)
- Timestamps and context in log entries
- Logs include request/response details at debug level

**Priority**: Medium

---

### US-022: Test Connection
**As a** Developer Dave  
**I want to** test if the extension can reach the inference server  
**So that** I can verify my configuration is correct

**Acceptance Criteria**:
- Command to test connection
- Shows available models if successful
- Clear error message if failed
- Suggests troubleshooting steps

**Priority**: Low

---

## Epic 6: Advanced Features

### US-023: Parallel Tool Calling
**As a** Power User Pete  
**I want to** allow the LLM to call multiple tools in parallel  
**So that** responses are faster when multiple independent actions are needed

**Acceptance Criteria**:
- Toggle for parallel tool calling in settings
- LLM can invoke multiple tools simultaneously
- Results are collected and sent back together
- Works with VS Code's tool execution API

**Priority**: Low

---

### US-024: Retry Failed Requests
**As a** Developer Dave  
**I want to** have the extension automatically retry failed requests  
**So that** transient network issues don't interrupt my workflow

**Acceptance Criteria**:
- Automatic retry on retryable errors (429, 500, 502, 503, 504)
- Exponential backoff with jitter
- Configurable max retries and base delay
- Clear indication when retries are happening

**Priority**: Medium

---

### US-025: MCP Server Integration
**As a** Power User Pete  
**I want to** configure MCP servers to extend available tools  
**So that** I can use third-party tools with the extension

**Acceptance Criteria**:
- Add MCP server config in settings
- Support stdio and SSE transport types
- MCP tools appear in tool calling flow
- Start/stop MCP servers from extension
- View MCP server status

**Priority**: High

---

### US-026: Inline Code Suggestions
**As a** Developer Dave  
**I want to** see code suggestions as I type  
**So that** I can code faster without leaving the editor

**Acceptance Criteria**:
- Suggestions appear inline as ghost text
- Support single-line and multi-line completions
- Tab to accept suggestion
- Debounce to avoid excessive requests
- Configure suggestion delay

**Priority**: High

---

### US-027: Inline Chat
**As a** Developer Dave  
**I want to** open a chat prompt in the editor  
**So that** I can describe changes without losing editor context

**Acceptance Criteria**:
- Trigger inline chat with Ctrl+I
- Show prompt widget near cursor
- Apply edits directly to editor
- Maintain selected code context
- Dismiss without applying

**Priority**: Medium

---

### US-028: Tab Autocomplete
**As a** Developer Dave  
**I want to** use tab completion for AI suggestions  
**So that** I can quickly accept completions in my flow

**Acceptance Criteria**:
- Configure autocomplete options per model
- Support prefix/suffix context
- Include recently edited files
- Configure stop words and templates
- Enable/disable per model

**Priority**: Medium

---

### US-029: Context Providers
**As a** Data Scientist Dana  
**I want to** include additional context sources  
**So that** the LLM has more relevant information

**Acceptance Criteria**:
- Include specific files as context
- Include surrounding code context
- Include git diff context
- Fetch URL/HTTP content as context
- Include terminal output as context

**Priority**: Medium

---

### US-030: Rules System
**As a** Power User Pete  
**I want to** define project-wide coding rules  
**So that** the LLM follows our conventions automatically

**Acceptance Criteria**:
- Create rules file in workspace
- Rules included in system message
- Support multiple rule sets
- Allow remote rules via URL
- Disable rules temporarily if needed

**Priority**: Medium

---

### US-031: Prompt Commands
**As a** Developer Dave  
**I want to** create reusable prompt templates with `/command`  
**So that** I can quickly invoke common prompts

**Acceptance Criteria**:
- Define prompts with `/command` syntax
- Support variables in prompts
- Store prompts locally or remotely
- Invoke from chat interface
- Show prompt descriptions

**Priority**: Low

---

### US-032: Agent Mode
**As a** Developer Dave  
**I want to** assign end-to-end coding tasks to an agent  
**So that** I can focus on other work while it completes

**Acceptance Criteria**:
- Describe task in natural language
- Agent plans and implements solution
- Edits multiple files across project
- Runs commands and tests
- Self-corrects when errors occur
- Provides progress updates

**Priority**: Low

---

### US-033: Plan Mode
**As a** Power User Pete  
**I want to** see a plan before code changes are made  
**So that** I can review and modify the approach

**Acceptance Criteria**:
- Agent analyzes task and creates plan
- Shows step-by-step implementation plan
- Ask clarifying questions if needed
- Allow plan modification
- Hand off approved plan to implementation

**Priority**: Low

---

### US-034: Documentation Indexing
**As a** Data Scientist Dana  
**I want to** index documentation sites for context  
**So that** the LLM can reference accurate docs

**Acceptance Criteria**:
- Configure docs sites to index
- Crawl from start URL
- Use indexed docs in responses
- Update indexed content periodically
- Show doc sources in responses

**Priority**: Low

---

### US-025: Model Caching
**As a** Data Scientist Dana  
**I want to** have the model list cached  
**So that** the extension doesn't fetch models on every startup

**Acceptance Criteria**:
- Model list cached in memory
- Configurable cache TTL
- Clear cache command available
- Cache respects configuration changes

**Priority**: Low

---

### US-026: Multiple Workspace Support
**As a** Developer Dave  
**I want to** use the extension with different workspace folders  
**So that** each project can have its own chat logs and settings

**Acceptance Criteria**:
- Chat logs stored in workspace folder
- Sessions isolated per workspace
- Works with multi-root workspaces
- Fallback to global storage when no workspace

**Priority**: Medium

---

### US-027: Reasoning Content Display
**As a** Data Scientist Dana  
**I want to** see the reasoning/thinking content from models that provide it  
**So that** I can understand how the model arrived at its answer

**Acceptance Criteria**:
- Parse reasoning content from response
- Display in expandable section
- Support multiple formats (reasoning_content, reasoning, thinking)
- Option to show/hide reasoning content

**Priority**: Low

---

## Story Priority Summary

| Priority | Story IDs |
|----------|-----------|
| High | US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-018 |
| Medium | US-008, US-009, US-010, US-011, US-014, US-015, US-016, US-017, US-019, US-020, US-021, US-024, US-026 |
| Low | US-012, US-013, US-022, US-023, US-025, US-027 |
