// main.js – handles session list and chat view in #top-area
const vscode = acquireVsCodeApi();

/**
 * Simple logger for the webview.  The extension can enable verbose
 * logging via the configuration.  Errors are forwarded to the
 * extension so they can be surfaced to the user.
 * @param {string} level - One of 'debug', 'info', 'warn', 'error'.
 * @param {string} message - The message to log.
 */
function log(level, message) {
    try {
        vscode.postMessage({ command: 'log', level, message: `[LMP] ${message}` });
    } catch (e) {
        // If the extension is not ready, fall back to console
        console[level === 'error' ? 'error' : 'log'](`[LMP] ${message}`);
    }
}

// UI Elements
const topArea = document.getElementById('top-area');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const modelSelect = document.getElementById('model-select');

// State variables
let chatContainer = null;
let currentSessionId = null;
let userSelectedSession = false;
let currentThinkingBox = null;
let currentAgentBox = null;
let contextFiles = [];
// Track accumulated content for streaming messages
let streamingMessageContent = '';
let streamingMessageElement = null;

// Lightweight markdown rendering
function renderMarkdown(text) {
    if (!text) return '';
    
    // Escape HTML to prevent XSS
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Code blocks with language
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        const language = lang || 'plaintext';
        const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
        return `<div class="code-block-wrapper">
            <div class="code-block-header">
                <span class="code-language">${language}</span>
                <div class="code-actions">
                    <button class="copy-code-btn" onclick="copyCode('${codeId}')">Copy</button>
                    <button class="apply-code-btn" onclick="applyCode('${codeId}', '${language}')">Apply</button>
                </div>
            </div>
            <pre><code id="${codeId}">${code}</code></pre>
        </div>`;
    });
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    
    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    
    return '<p>' + html + '</p>';
}

// Copy code to clipboard
function copyCode(codeId) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    const code = codeElement.textContent;
    navigator.clipboard.writeText(code).then(() => {
        // Find the copy button and update its text
        const wrapper = codeElement.closest('.code-block-wrapper');
        const btn = wrapper?.querySelector('.copy-code-btn');
        if (btn) {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = 'Copy';
                btn.classList.remove('copied');
            }, 2000);
        }
    }).catch(err => log('error', 'Failed to copy code: ' + err));
}

// Apply code to file
function applyCode(codeId, language) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    const code = codeElement.textContent;
    log('info', `Applying code (${language}) to file`);
    
    // Send to backend to handle file writing
    vscode.postMessage({
        command: 'applyCode',
        code: code,
        language: language
    });
    
    // Visual feedback
    const wrapper = codeElement.closest('.code-block-wrapper');
    const btn = wrapper?.querySelector('.apply-code-btn');
    if (btn) {
        const originalText = btn.textContent;
        btn.textContent = 'Applied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }
}

// Message action handlers
function copyMessage(messageElement) {
    const text = messageElement.textContent;
    navigator.clipboard.writeText(text).then(() => {
        log('info', 'Message copied to clipboard');
    }).catch(err => log('error', 'Failed to copy message: ' + err));
}

function editMessage(messageElement) {
    const text = messageElement.textContent;
    userInput.value = text;
    userInput.focus();
    log('info', 'Message loaded for editing');
}

function regenerateMessage() {
    log('info', 'Regenerate message requested');
    vscode.postMessage({
        command: 'regenerateMessage'
    });
}

function deleteMessage(messageElement) {
    if (confirm('Delete this message?')) {
        messageElement.remove();
        log('info', 'Message deleted');
        vscode.postMessage({
            command: 'deleteMessage',
            sessionId: currentSessionId
        });
    }
}

function addMessageActions(messageElement, isUserMessage) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    
    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-action-btn';
    copyBtn.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 2h8v2H4V2zm0 4h8v2H4V6zm0 4h5v2H4v-2z"/></svg>';
    copyBtn.title = 'Copy';
    copyBtn.onclick = () => copyMessage(messageElement);
    actionsDiv.appendChild(copyBtn);
    
    if (isUserMessage) {
        // Edit button for user messages
        const editBtn = document.createElement('button');
        editBtn.className = 'message-action-btn';
        editBtn.innerHTML = '<svg viewBox="0 0 16 16"><path d="M13.5 1.5l1 1-9 9-1.5.5.5-1.5 9-9z"/></svg>';
        editBtn.title = 'Edit';
        editBtn.onclick = () => editMessage(messageElement);
        actionsDiv.appendChild(editBtn);
    }
    
    messageElement.style.position = 'relative';
    messageElement.appendChild(actionsDiv);
}

// @file mention autocomplete
let autocompleteActive = false;

function handleAtMention(event) {
    const input = event.target;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = input.value.substring(0, cursorPos);
    
    // Check if @ was just typed
    if (textBeforeCursor.endsWith('@')) {
        autocompleteActive = true;
        log('info', '@file mention triggered');
        
        // Request file list from backend
        vscode.postMessage({
            command: 'requestFileList',
            query: ''
        });
    } else if (autocompleteActive) {
        // Extract query after @
        const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1) {
            const query = textBeforeCursor.substring(atIndex + 1);
            vscode.postMessage({
                command: 'requestFileList',
                query: query
            });
        }
    }
}

// Add file to context
function addFileContext(filePath) {
    if (!contextFiles.includes(filePath)) {
        contextFiles.push(filePath);
        renderContextChips();
        log('info', `Added file to context: ${filePath}`);
        
        // Remove @ mention from input
        const input = userInput.value;
        const atIndex = input.lastIndexOf('@');
        if (atIndex !== -1) {
            userInput.value = input.substring(0, atIndex) + input.substring(userInput.selectionStart);
        }
        autocompleteActive = false;
    }
}

// Context chip management
function renderContextChips() {
    const container = document.getElementById('context-mentions');
    if (!container) return;
    
    container.innerHTML = '';
    
    contextFiles.forEach(filePath => {
        const chip = document.createElement('div');
        chip.className = 'context-chip';
        
        const fileName = filePath.split(/[/\\]/).pop();
        const label = document.createElement('span');
        label.className = 'context-chip-label';
        label.textContent = fileName;
        label.title = filePath;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'context-chip-remove';
        removeBtn.innerHTML = '×';
        removeBtn.onclick = () => removeFileContext(filePath);
        
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

function removeFileContext(filePath) {
    contextFiles = contextFiles.filter(f => f !== filePath);
    renderContextChips();
    log('info', `Removed file from context: ${filePath}`);
}

// Initialize button states (send visible, stop hidden)
function initializeButtons() {
  if (sendBtn) {
    sendBtn.style.display = 'block';
  }
  if (stopBtn) {
    stopBtn.style.display = 'none';
  }
}

// Notify extension that webview is ready
log('info', 'Webview JS loaded, sending webviewReady...');
vscode.postMessage({ command: 'webviewReady' });
initializeButtons();

// Request initial data
log('info', 'Requesting sessions and models...');
vscode.postMessage({ command: 'requestSessions' });
vscode.postMessage({ command: 'requestModels' });

// Handle send button click
sendBtn.addEventListener('click', () => {
    const text = userInput.value.trim();
    if (!text) return;
    log('info', `Send button clicked with text: ${text.substring(0, 50)}...`);
    userInput.value = '';
    // Send message to extension with context files
    vscode.postMessage({
        command: 'sendMessage',
        text: text,
        model: modelSelect.value,
        sessionId: currentSessionId,
        contextFiles: contextFiles
    });
    // Clear context after sending
    contextFiles = [];
    renderContextChips();
});

// Handle stop button click
stopBtn.addEventListener('click', () => {
    log('info', 'Stop button clicked');
    vscode.postMessage({ command: 'stopRequest' });
});

// Handle attach button click
const attachBtn = document.getElementById('attach-btn');
if (attachBtn) {
    attachBtn.addEventListener('click', () => {
        const filePicker = document.getElementById('file-picker');
        if (filePicker) {
            filePicker.click();
        }
    });
}

// Handle file picker selection
const filePicker = document.getElementById('file-picker');
if (filePicker) {
    filePicker.addEventListener('change', (event) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            // For now, just show file names - backend integration needed
            Array.from(files).forEach(file => {
                log('info', `File selected: ${file.name}`);
            });
        }
    });
}

// Handle @ mention input
userInput.addEventListener('input', handleAtMention);

// Handle model selection change
modelSelect.addEventListener('change', () => {
    log('info', `Model selection changed to: ${modelSelect.value}`);
    vscode.postMessage({
        command: 'modelSelected',
        model: modelSelect.value
    });
});

// Handle textarea key events - Enter sends message, Shift+Enter adds new line
userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        if (event.shiftKey) {
            // Shift+Enter - add new line
            return; // Let default behavior happen (add new line)
        } else {
            // Enter - send message
            event.preventDefault(); // Prevent default new line behavior
            const text = userInput.value.trim();
            if (!text) return;
            log('info', `Enter key pressed with text: ${text.substring(0, 50)}...`);
            userInput.value = '';
            // Send message to extension
            vscode.postMessage({
                command: 'sendMessage',
                text: text,
                model: modelSelect.value,
                sessionId: currentSessionId
            });
        }
    }
});

// Render session list in #top-area
function renderSessionList(sessions, activeSessionId) {
    if (!topArea) return;
    
    log('info', 'Rendering session list view');
    topArea.innerHTML = '';
    
    const header = document.createElement('h3');
    header.textContent = 'Sessions';
    topArea.appendChild(header);
    
    if (!sessions || sessions.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'No sessions yet. Click "Create New Session" to start.';
        topArea.appendChild(p);
        return;
    }

    const listDiv = document.createElement('div');
    listDiv.id = 'session-list';
    
    sessions.forEach(session => {
        const div = document.createElement('div');
        div.className = 'session-item';
        if (session.id === activeSessionId) {
            div.classList.add('active');
        }
        div.textContent = session.title || session.id || 'New Chat';
        div.onclick = () => {
            userSelectedSession = true;
            currentSessionId = session.id;
            log('info', `Session selected: ${session.id}`);
            vscode.postMessage({
                command: 'switchSession',
                sessionId: session.id
            });
        };
        listDiv.appendChild(div);
    });
    
    topArea.appendChild(listDiv);
}

// Render chat view in #top-area
function renderChatView(session) {
    if (!topArea) return;
    
    log('info', `Rendering chat view for session: ${session.id}`);
    topArea.innerHTML = '';
    
    // Header with back button and title
    const header = document.createElement('div');
    header.id = 'chat-header';
    
    const backBtn = document.createElement('button');
    backBtn.textContent = '←'; //Back to sessions
    backBtn.id='back-btn';
    backBtn.onclick = () => {
        currentSessionId = undefined;
        userSelectedSession = false;
        vscode.postMessage({ command: 'requestSessions' });
    };
    header.appendChild(backBtn);
    
    const title = document.createElement('div');
    title.id = 'session-title';
    title.textContent = session.title || 'New Chat';
    header.appendChild(title);
    topArea.appendChild(header);
    
    // Chat container
    const chatDiv = document.createElement('div');
    chatDiv.id = 'chat-container';
    topArea.appendChild(chatDiv);
    chatContainer = chatDiv;
    
    // Render all messages in the chat container
    session.messages.forEach(msg => {
        const messageDiv = document.createElement('div');
        // Assign class based on sender
        if (msg.role === 'assistant' || msg.sender === 'assistant') {
            messageDiv.className = 'message agent';
        } else if (msg.role === 'user' || msg.sender === 'user') {
            messageDiv.className = 'message user';
        } else if (msg.role === 'system'){
            // System prompts are collapsed by default; CSS handles the styling
            messageDiv.className = 'message prompt collapsed';
            // Toggle expand/collapse on click by toggling the "collapsed" class
            messageDiv.addEventListener('click', () => {
                messageDiv.classList.toggle('collapsed');
            });
        } else {
            messageDiv.className = 'message error';
        }
        // Set content, escaping if necessary
        if (msg.role === 'assistant' || msg.sender === 'assistant') {
            messageDiv.innerHTML = renderMarkdown(msg.content || '');
            addMessageActions(messageDiv, false);
        } else {
            messageDiv.textContent = msg.content || '';
            addMessageActions(messageDiv, true);
        }
        chatContainer.appendChild(messageDiv);
    });
    // Ensure the latest messages are visible
    chatContainer.scrollTop = chatContainer.scrollHeight;

    currentSessionId = session.id;
}

// Receive messages from extension
window.addEventListener('message', event => {
    const msg = event.data;
    console.log('[LMP] Received message:', msg.type, msg);
    
    if (msg.type === 'models') {
        // Receive available models from extension
        log('info', `Received ${msg.models?.length || 0} models`);
        const models = msg.models || [];
        modelSelect.innerHTML = '';
        if (models.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No models available';
            modelSelect.appendChild(option);
            return;
        }
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name || model.id;
            option.title = model.tooltip || '';
            if (model.id === msg.defaultModel) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });
    }
    
    if (msg.type === 'sessions') {
        // Receive sessions and render list
        log('info', `Received ${msg.sessions?.length || 0} sessions`);
        renderSessionList(msg.sessions, msg.activeSessionId);
    }
    
    if (msg.type === 'showChat') {
        // Show chat view for a session (explicit request)
        /*
        if (!userSelectedSession) {
            log('info', 'Ignoring showChat - user has not selected a session yet');
            console.log('[LMP] Ignoring showChat, userSelectedSession =', userSelectedSession);
            return;
        }
        */
        renderChatView(msg.session);
        // Update model dropdown to match the session's model ID
        if (msg.session && msg.session.modelId && modelSelect) {
            log('info', `Updating model dropdown to: ${msg.session.modelId}`);
            modelSelect.value = msg.session.modelId;
        }
    }
    
    if (msg.type === 'messageResponse') {
        // Received response from the model
        log('info', `Received message response: ${msg.content?.substring(0, 50)}...`);
        // Collapse any existing thinking box before showing the normal assistant message
        if (currentThinkingBox) {
            currentThinkingBox.classList.add('collapsed');
            currentThinkingBox = null; // Clear reference to the thinking box
        }
        if (chatContainer) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message agent';
            messageDiv.innerHTML = renderMarkdown(msg.content);
            addMessageActions(messageDiv, false);
            chatContainer.appendChild(messageDiv);
            // Ensure the new message is visible
            messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }

    // Streaming chunk handling
    if (msg.type === 'messageChunk') {
        // Append incremental content to the last assistant message or create one
        if (!chatContainer) return;
        // Collapse any existing thinking box when a normal chunk arrives
        if (currentThinkingBox) {
            currentThinkingBox.classList.add('collapsed');
            currentThinkingBox = null; // Clear reference to the thinking box
        }
        // Find the last assistant message element, or create a new one if none
        if (!streamingMessageElement) {
            streamingMessageElement = chatContainer.querySelector('.message.agent:last-child, .message.prompt:last-child');
        }
        if (!streamingMessageElement) {
            streamingMessageElement = document.createElement('div');
            streamingMessageElement.className = 'message agent';
            streamingMessageElement.innerHTML = '';
            addMessageActions(streamingMessageElement, false);
            chatContainer.appendChild(streamingMessageElement);
        }
        // Accumulate raw content and re-render full markdown
        streamingMessageContent += msg.content || '';
        streamingMessageElement.innerHTML = renderMarkdown(streamingMessageContent);
        // Scroll into view
        streamingMessageElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    if (msg.type === 'reasoningChunk') {
        // Handle reasoning/thinking chunks - display in a thinking box
        if (!chatContainer) return;
        
        // If we don't have a thinking box yet, create one
        if (!currentThinkingBox) {
            currentThinkingBox = document.createElement('div');
            currentThinkingBox.className = 'message thinking';
            currentThinkingBox.innerHTML = '<strong>Thinking:</strong><br>';
            // Allow user to toggle collapse/expand by clicking; use function to reference the element itself
            currentThinkingBox.addEventListener('click', function () {
                this.classList.toggle('collapsed');
            });
            chatContainer.appendChild(currentThinkingBox);
        } else {
            // Ensure the box is expanded when new reasoning arrives
            currentThinkingBox.classList.remove('collapsed');
        }
        
        // Append the reasoning content to the thinking box
        currentThinkingBox.innerHTML += msg.content || '';
        // Scroll into view
        currentThinkingBox.scrollIntoView({ behavior: 'smooth', block: 'end' });
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    if (msg.type === 'messageDone') {
        // Finalize the streaming response, optionally show usage or cancellation info
        if (!chatContainer) return;
        // Ensure a final newline or spacing
        const lastAgentMsg = chatContainer.querySelector('.message.agent:last-child');
        if (lastAgentMsg && msg.usage) {
            const usageDiv = document.createElement('div');
            usageDiv.className = 'usage-info';
            usageDiv.textContent = `Tokens used: ${msg.usage.total_tokens || ''} (${msg.usage.tokenSpeed.toFixed(2)} tps)`;
            lastAgentMsg.appendChild(usageDiv);
        }
        if (msg.cancelled) {
            const cancelDiv = document.createElement('div');
            cancelDiv.className = 'cancel-info';
            cancelDiv.textContent = '(generation cancelled)';
            chatContainer.appendChild(cancelDiv);
        }
        // Reset streaming state
        streamingMessageContent = '';
        streamingMessageElement = null;
        // Scroll to bottom after done
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Handle tool call requests from the extension
    if (msg.type === 'toolCall') {
        if (!chatContainer) return;
        const { name, arguments: args, toolCallId } = msg;
        // Display the tool call information for the user to see, but do not request a result.
        const toolDiv = document.createElement('div');
        toolDiv.className = 'tool-call';
        toolDiv.dataset.toolCallId = toolCallId;
        toolDiv.innerHTML = `<div class="tool-name">Tool: ${name}</div>` +
            `<pre class="tool-args">${JSON.stringify(args, null, 2)}</pre>` +
            `<div class="tool-info">Executing automatically…</div>`;
        chatContainer.appendChild(toolDiv);
        toolDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
        // No input field or submit button – the extension runs the tool and will send the result back automatically.
    }

    if (msg.type == 'user'){
        // Add user message to chat container
        if (chatContainer) {
            // Reset streaming state for new user message
            streamingMessageContent = '';
            streamingMessageElement = null;
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user';
            messageDiv.textContent = msg.content;
            addMessageActions(messageDiv, true);
            chatContainer.appendChild(messageDiv);
            // Ensure the new message is visible
            messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }
    
    if (msg.type === 'messageError') {
        // Error sending message
        log('error', `Message error: ${msg.error}`);
        if (chatContainer) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'message error';
            errorDiv.textContent = `Error: ${msg.error}`;
            chatContainer.appendChild(errorDiv);
        }
    }
});
