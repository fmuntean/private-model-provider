# Assumptions and Constraints

## Overview
This document captures the assumptions made during requirements elicitation and the constraints that limit the solution space for the Private Model Provider VS Code extension.

---

## Assumptions

### A-001: Users Have Local Inference Server Running
**Assumption**: Users have access to a running OpenAI-compatible inference server (vLLM, Ollama, etc.) before using the extension.

**Impact**: If no server is running, the extension cannot function. We provide documentation but no built-in server management.

**Validation**: Documented in README and quick start guide.

---

### A-002: Users Understand Basic LLM Concepts
**Assumption**: Users understand concepts like models, tokens, temperature, and context windows.

**Impact**: UI and documentation use technical terms without extensive explanation.

**Validation**: Consider adding tooltips or a glossary (see `07_Glossary.md`).

---

### A-003: Single Workspace Folder
**Assumption**: When a workspace is open, it has at least one folder, and we use the first folder for storage.

**Impact**: Multi-root workspaces use only the first folder. This is a known limitation.

**Validation**: Code in `sessionManager.ts` and `provider.ts` uses `workspaceFolders[0]`.

---

### A-004: VS Code Version Compatibility
**Assumption**: Users run VS Code version 1.100.0 or later, which supports the `LanguageModelChatProvider` API.

**Impact**: Extension won't activate on older VS Code versions.

**Validation**: Specified in `package.json` under `engines.vscode`.

---

### A-005: Inference Server Supports OpenAI API
**Assumption**: The configured inference server implements the OpenAI Chat Completions API (at least partially).

**Impact**: Servers with incompatible APIs won't work. We only support OpenAI-compatible endpoints.

**Validation**: Documented in README and CONFIGURATION.md.

---

### A-006: Network Connectivity to Server
**Assumption**: VS Code can reach the inference server URL (localhost or LAN).

**Impact**: Firewalls, proxies, or network issues can prevent connectivity.

**Validation**: Error handling and retry logic in `client.ts`.

---

### A-007: File System Access
**Assumption**: VS Code has read/write access to the workspace folder for storing chat logs and sessions.

**Impact**: If permissions are missing, sessions won't persist.

**Validation**: Fallback to `globalStorage` when workspace is unavailable.

---

### A-008: Single User per VS Code Instance
**Assumption**: Only one user is using VS Code at a time, so API keys and settings are user-specific.

**Impact**: No multi-user support or user switching.

**Validation**: Standard VS Code extension behavior.

---

### A-009: Model List Fits in Memory
**Assumption**: The number of models returned by the server is reasonable (typically <100) and fits in memory.

**Impact**: No pagination for model list; large model lists could cause issues.

**Validation**: No pagination implemented in `fetchModels()`.

---

### A-010: JSONL Format is Sufficient
**Assumption**: Storing chat messages in JSONL format provides adequate performance for the expected number of messages.

**Impact**: Very large conversations might be slow to load.

**Validation**: Lazy loading implemented; messages loaded on demand.

---

## Constraints

### C-001: VS Code Extension API Limitations
**Constraint**: The extension must work within VS Code's extension API boundaries.

**Details**:
- Must use `vscode.LanguageModelChatProvider` for Copilot Chat integration
- Webview has CSP restrictions
- SecretStorage is the only secure storage option
- Cannot access arbitrary files outside workspace without user consent

**Impact**: Architecture must align with VS Code's extension model.

---

### C-002: OpenAI API Compatibility Only
**Constraint**: The extension only supports OpenAI-compatible APIs.

**Details**:
- Must use `/v1/chat/completions` endpoint format
- Must parse Server-Sent Events for streaming
- Tool calling must follow OpenAI function calling format

**Impact**: Cannot support non-OpenAI APIs (e.g., Anthropic's Messages API) without major refactoring.

---

### C-003: JavaScript/TypeScript Runtime
**Constraint**: The extension runs in VS Code's Electron/Node.js runtime.

**Details**:
- No browser APIs (use Node.js `fs`, `path`, `crypto`)
- Must bundle with esbuild for CommonJS format
- Limited to Node.js version bundled with VS Code

**Impact**: Cannot use browser-specific libraries or modern Node.js features not in the bundled version.

---

### C-004: Local-First Processing
**Constraint**: All LLM processing must happen on user-controlled infrastructure.

**Details**:
- No cloud API calls unless user explicitly configures one
- No telemetry without opt-in
- No data sent to third parties

**Impact**: Cannot add cloud-based features unless user consents and configures them.

---

### C-005: Performance Requirements
**Constraint**: Extension must not degrade VS Code performance.

**Details**:
- Memory usage under 100MB
- Idle CPU near 0%
- UI remains responsive during operations
- File operations must be fast

**Impact**: Must optimize token estimation, use caching, lazy-load data.

---

### C-006: Security Requirements
**Constraint**: Sensitive data must be protected.

**Details**:
- API keys stored only in SecretStorage
- CSP must be set in webview
- No eval() or unsafe-inline scripts
- Input validation on all user-provided data

**Impact**: Cannot use convenience features that compromise security.

---

### C-007: Backward Compatibility
**Constraint**: Settings and data formats should be backward compatible.

**Details**:
- Old `settings.json` configurations should still work
- Session files from previous versions must be readable
- Migration path for breaking changes

**Impact**: Careful when changing configuration schema or file formats.

---

### C-008: Platform Compatibility
**Constraint**: Extension must work on Windows, macOS, and Linux.

**Details**:
- Use cross-platform APIs (path.join vs. string concatenation)
- No OS-specific assumptions
- Test on all three platforms

**Impact**: Cannot use Windows-specific or macOS-specific features without guards.

---

### C-009: License Constraints
**Constraint**: Extension is MIT-licensed.

**Details**:
- Can use MIT/Apache/BSD-licensed dependencies
- Cannot use GPL-licensed dependencies (would affect license)
- Must include license file

**Impact**: Careful selection of third-party libraries.

---

### C-010: No External Database
**Constraint**: Extension cannot require external database setup.

**Details**:
- Use file system for persistence
- Use VS Code's Memento (globalState) for small data
- No MongoDB, PostgreSQL, etc.

**Impact**: All persistence must be file-based or use VS Code APIs.

---

### C-011: VS Code Marketplace Guidelines
**Constraint**: Extension must comply with VS Code Marketplace policies.

**Details**:
- No misleading descriptions
- No malicious code
- Proper icon and branding
- Clear documentation

**Impact**: Must follow Microsoft's publishing guidelines.

---

### C-012: Token Context Window Limits
**Constraint**: Must respect the model's context window.

**Details**:
- Estimate tokens and truncate if needed
- Different models have different limits
- User must configure correctly for their model

**Impact**: Token estimation logic is critical; incorrect estimates cause errors.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Inference server goes down during use | Medium | High | Retry logic, clear error messages |
| Token estimation is inaccurate | Medium | Medium | Use conservative estimates, allow manual override |
| API changes in VS Code | Low | High | Monitor VS Code updates, use stable APIs |
| Large session history slows UI | Low | Medium | Lazy loading, pagination |
| API key compromised | Low | High | Secure storage, never log keys |
| Extension crashes VS Code | Low | High | Extensive error handling, try-catch |

---

## Dependencies

### External Dependencies
- **VS Code API**: Extension cannot run without VS Code
- **Inference Server**: User must provide a running server
- **Node.js Runtime**: Bundled with VS Code, not user-installed

### Internal Dependencies
- `GatewayClient` depends on `GatewayConfig`
- `GatewayProvider` depends on `GatewayClient`, `SecretManager`, `StatisticsManager`, `SessionManager`
- `ChatWebview` depends on `GatewayProvider`
- `StatusBarManager` depends on `StatisticsManager`

---

## Exclusions

The following are **out of scope** for this extension:

1. **Managing inference servers**: We don't start/stop servers; users must do this
2. **Model training or fine-tuning**: We only interact with existing models
3. **Cloud LLM providers**: Unless user configures an OpenAI-compatible endpoint
4. **Multi-user support**: Single user per VS Code instance
5. **Real-time collaboration**: No shared sessions or collaborative features
6. **Mobile support**: VS Code mobile not supported
7. **Offline mode**: Requires running inference server (can't work offline)
