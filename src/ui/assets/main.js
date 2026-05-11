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
            messageDiv.className = 'message prompt';
        }else {
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
            option.textContent = model.id;
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
    }
    
    if (msg.type === 'messageResponse') {
        // Received response from the model
        log('info', `Received message response: ${msg.content?.substring(0, 50)}...`);
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
            errorDiv.className = 'message error-message';
            errorDiv.textContent = `Error: ${msg.error}`;
            chatContainer.appendChild(errorDiv);
        }
    }
});
