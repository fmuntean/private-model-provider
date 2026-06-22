# Send Message Flow - Private Model Provider

This document describes the complete flow when a user sends their first message through the Private Model Provider extension.

## Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant Webview as Webview (main.js)
    participant Extension as Extension (extension.ts)
    participant Provider as GatewayProvider (provider.ts)
    participant Client as GatewayClient (client.ts)
    participant Server as LLM Server
    participant SessionMgr as SessionManager
    participant StatsMgr as StatisticsManager

    Note over User,Webview: Initial State: Session List View
    User->>Webview: Opens extension
    Webview->>Extension: postMessage({ command: 'webviewReady' })
    Extension->>Extension: Fetch models and sessions
    Extension->>Webview: postMessage({ type: 'models', ... })
    Extension->>Webview: postMessage({ type: 'sessions', ... })
    Webview->>Webview: showSessionList()
    Note over Webview: Displays session list<br/>No chat view visible
    
    User->>Webview: Clicks Send button (no active session)
    Webview->>Webview: sendOrCreateMessage(text)
    Note over Webview: command: 'sendMessage'<br/>text, model, sessionId (null)
    
    Webview->>Extension: vscode.postMessage(payload)
    
    Extension->>Extension: onDidReceiveMessage handler
    Note over Extension: Checks message.command === 'sendMessage'
    
    Extension->>Extension: Creates CancellationTokenSource
    Extension->>Provider: streamMessage(text, model, callback, token, sessionId)
    
    Provider->>Provider: Await initializationPromise
    Note over Provider: Ensures API key is loaded
    
    Provider->>SessionMgr: getActiveSession()
    SessionMgr-->>Provider: null (no active session)
    
    Provider->>SessionMgr: createSession(targetModelId)
    Note over SessionMgr: Creates new ChatSession<br/>with unique ID, title="New Chat"
    SessionMgr-->>Provider: New session object
    SessionMgr->>Extension: fire onDidChangeSession({ type: 'created' })
    Extension->>Webview: postMessage({ type: 'sessions', ... })
    Note over Webview: Still showing session list<br/>Title is "New Chat"
    
    Provider->>SessionMgr: addMessage('user', 'user', text)
    Note over SessionMgr: Adds user message to session
    
    Provider->>Provider: generateSessionTitle(text, session.id)
    Note over Provider: Fire and forget<br/>Uses small model or default
    
    Note over Provider,Server: Title Generation (async)
    Provider->>SessionMgr: updateSessionTitle(sessionId, title)
    SessionMgr->>Extension: fire onDidChangeSession({ type: 'updated' })
    Extension->>Webview: postMessage({ type: 'showChat', sessionId, sessionTitle })
    Webview->>Webview: showChatView(sessionId, title)
    Note over Webview: Now switches to chat view<br/>Displays generated title
    
    Provider->>SessionMgr: getMasterPrompt()
    
    alt Master prompt exists and first message
        Provider->>Provider: Add system message with master prompt
    end
    
    Provider->>Provider: Build OpenAI messages array
    Note over Provider: Includes system prompt +<br/>conversation history
    
    Provider->>Provider: Prepare requestOptions
    Note over Provider: model, messages, max_tokens,<br/>temperature, stream:true
    
    Provider->>Client: streamChatCompletion(requestOptions, token)
    
    loop For each chunk from server
        Client->>Server: HTTP POST /v1/chat/completions (streaming)
        Server-->>Client: SSE chunk with content
        Client-->>Provider: yield chunk with content
        
        Provider->>Extension: onChunk({ content: chunk.content })
        Extension->>Webview: postMessage({ type: 'assistant-chunk', content })
        Webview->>Webview: Append to chat container
    end
    
    Server-->>Client: Final chunk with usage stats
    Client-->>Provider: yield chunk with usage
    
    Provider->>Provider: fullContent += chunk.content
    Provider->>SessionMgr: addMessage('agent', 'assistant', fullContent)
    
    Provider->>StatsMgr: recordChatUsage(finalUsage, targetModelId)
    Provider->>SessionMgr: updateTokenUsage('agent',0, completionTokens)
    
    Provider->>Extension: onChunk({ done: true, usage: finalUsage })
    Extension->>Webview: postMessage({ type: 'assistant-done', usage })
    
    Webview->>Webview: Mark message as complete
    Webview->>Webview: Display token usage
    Webview->>Webview: Reset buttons (show send, hide stop)
    
    Note over User,StatsMgr: First message flow complete<br/>Session created with title displayed
```

## Detailed Flow Explanation

### Initial State (Webview Loads)
- Webview displays the **session list** by default (not the chat view)
- The **input controls** (textarea, model selector, send/stop buttons) are always visible at the bottom
- If there's an active session with a proper title (not "New Chat"), the chat view is shown

### 1. User Action
The user types a message in the textarea and clicks the **Send** button (or presses Enter).

### 2. Webview Processing (`main.js`)
- The `sendOrCreateMessage(text)` function is called
- It retrieves the selected model from the dropdown
- Creates a payload with:
  - `command: 'sendMessage'`
  - `text`: The user's message
  - `model`: The selected model ID
  - `sessionId`: `null` (since this is the first message)
- Sends the payload using `vscode.postMessage(payload)`
- Toggles button visibility: shows **Stop** button, hides **Send** button

### 3. Extension Message Handler (`extension.ts`)
- The `onDidReceiveMessage` callback in `ChatSideBarProvider` receives the message
- Validates that `message.command === 'sendMessage'`
- Creates a `CancellationTokenSource` to allow request cancellation
- Calls `provider.streamMessage()` with:
  - The user's text
  - The selected model
  - A callback function to handle streaming chunks
  - The cancellation token
  - The session ID (null for first message)

### 4. Provider Initialization (`provider.ts`)
- `streamMessage()` awaits `initializationPromise` to ensure:
  - API key is loaded from secure storage
  - Configuration is properly initialized

### 5. Session Management
- Checks for an active session via `sessionManager.getActiveSession()`
- Since this is the first message, no active session exists
- Creates a new session using `sessionManager.createSession(targetModelId)`
  - Generates a unique session ID
  - Sets the session title to "New Chat" (will be updated later)
  - Stores the selected model as `lastUsedModel`
- Adds the user's message to the session via `sessionManager.addMessage()`
- Fires `onDidChangeSession({ type: 'created' })` event
  - Extension receives event, sends updated sessions to webview
  - Since title is "New Chat", webview stays on session list

### 6. Title Generation (Fire and Forget)
- `generateSessionTitle()` is called asynchronously
- Uses the configured `smallModel` or falls back to `defaultModel`
- Sends a request to the LLM to generate a concise title (10 words or less)
- Updates the session title when complete
- Calls `sessionManager.updateSessionTitle()` which fires `onDidChangeSession({ type: 'updated' })`
- Extension receives event and sends `sessionTitleUpdated` message to webview
- Webview switches to chat view with the new title

### 7. Request Preparation
- Retrieves the master prompt from session manager (if configured)
- If this is the first message and a master prompt exists:
  - Adds it as a system message with `messageType: 'prompt'`
- Builds the OpenAI-compatible messages array:
  - System message (master prompt, if any)
  - All previous conversation history from the session
- Prepares `requestOptions`:
  - `model`: Target model ID
  - `messages`: Array of conversation messages
  - `max_tokens`: From config (default: 2048)
  - `temperature`: 0.7
  - `stream: true`
  - `stream_options: { include_usage: true }`

### 8. Streaming Request
- Calls `client.streamChatCompletion(requestOptions, token)`
- The client makes an HTTP POST to `/v1/chat/completions` with streaming enabled
- Server responds with Server-Sent Events (SSE)

### 9. Streaming Response Loop
For each chunk received from the server:
- **Content chunks**: 
  - Client yields `{ content: chunk.text }`
  - Provider accumulates `fullContent += chunk.content`
  - Provider calls `onChunk({ content: chunk.content })`
  - Extension posts `assistant-chunk` message to webview
  - Webview appends the content to the chat container in real-time
  
- **Usage chunk** (final chunk):
  - Contains token usage statistics
  - Provider stores `finalUsage` for statistics

### 10. Completion Handling
- Provider adds the complete assistant response to the session
- Records token usage statistics via `statsManager.recordChatUsage()`
- Updates session token usage for different message types
- Calls `onChunk({ done: true, usage: finalUsage })`
- Extension posts `assistant-done` message to webview

### 11. Webview Update
- Marks the last assistant message as complete (removes `data-streaming` attribute)
- Displays token usage information (if available)
- Resets button visibility: shows **Send**, hides **Stop**
- Clears the `currentRequestId`

### 12. Cancellation Support
Throughout the streaming process:
- The cancellation token is checked at the start of each iteration
- If the user clicks **Stop**, the token is cancelled
- The loop breaks, and a `cancelled: true` flag is sent to the webview
- The webview marks the message with "[Stopped]"

## Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| Webview UI | `src/ui/assets/main.js` | Handles user input, displays messages, manages UI state |
| Webview Styles | `src/ui/assets/style.css` | Theming and layout |
| Extension | `src/extension.ts` | Registers providers, handles webview messages |
| Provider | `src/provider.ts` | Core logic, session management, streaming |
| Client | `src/client.ts` | HTTP communication with LLM server |
| Session Manager | `src/sessionManager.ts` | Chat session persistence and history |
| Statistics Manager | `src/statistics.ts` | Token usage tracking and statistics |

## Configuration Options Used

- `private.model.provider.defaultModel`: Default model to use
- `private.model.provider.smallModel`: Model for title generation
- `private.model.provider.serverUrl`: LLM server endpoint
- `private.model.provider.defaultMaxOutputTokens`: Max tokens in response
- Master prompt: `.llm/SystemPrompt.md` in workspace root

## Error Handling

- If no model is selected, an error is posted to the webview
- If the server is unreachable, the error is caught and displayed
- If the request is cancelled, the stream stops gracefully
- API key errors are handled during initialization
