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
    // Send message to extension
    vscode.postMessage({
        command: 'sendMessage',
        text: text,
        model: modelSelect.value,
        sessionId: currentSessionId
    });
});

// Handle stop button click
stopBtn.addEventListener('click', () => {
    log('info', 'Stop button clicked');
    vscode.postMessage({ command: 'stopRequest' });
});

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
        messageDiv.textContent = msg.content || '';
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
            messageDiv.textContent = msg.content;
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
        let lastAgentMsg = chatContainer.querySelector('.message.agent:last-child, .message.prompt:last-child');
        if (!lastAgentMsg) {
            lastAgentMsg = document.createElement('div');
            lastAgentMsg.className = 'message agent';
            lastAgentMsg.textContent = '';
            chatContainer.appendChild(lastAgentMsg);
        }
        // Append the new chunk
        lastAgentMsg.textContent += msg.content || '';
        // Scroll into view
        lastAgentMsg.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user';
            messageDiv.textContent = msg.content;
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
