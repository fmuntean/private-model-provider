// main.js – handles session list and chat view in #top-area
const vscode = acquireVsCodeApi();

// Simple logger for webview - sends logs to extension
function log(level, message) {
  vscode.postMessage({ command: 'log', level, message: `[LMP] ${message}` });
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
    
    // Add user message to chat container
    if (chatContainer) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        messageDiv.textContent = text;
        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
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
        div.textContent = session.title || 'New Chat';
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
function renderChatView(sessionId, sessionTitle) {
    if (!topArea) return;
    
    log('info', `Rendering chat view for session: ${sessionId}`);
    topArea.innerHTML = '';
    
    // Header with back button and title
    const header = document.createElement('div');
    header.id = 'chat-header';
    
    const backBtn = document.createElement('button');
    backBtn.textContent = '← Back';
    backBtn.onclick = () => {
        vscode.postMessage({ command: 'requestSessions' });
    };
    header.appendChild(backBtn);
    
    const title = document.createElement('div');
    title.id = 'session-title';
    title.textContent = sessionTitle || 'New Chat';
    header.appendChild(title);
    topArea.appendChild(header);
    
    // Chat container
    const chatDiv = document.createElement('div');
    chatDiv.id = 'chat-container';
    topArea.appendChild(chatDiv);
    chatContainer = chatDiv;
    
    currentSessionId = sessionId;
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
        if (!userSelectedSession) {
            log('info', 'Ignoring showChat - user has not selected a session yet');
            console.log('[LMP] Ignoring showChat, userSelectedSession =', userSelectedSession);
            return;
        }
        renderChatView(msg.sessionId, msg.sessionTitle);
    }
    
    if (msg.type === 'messageResponse') {
        // Received response from the model
        log('info', `Received message response: ${msg.content?.substring(0, 50)}...`);
        if (chatContainer) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant-message';
            messageDiv.textContent = msg.content;
            chatContainer.appendChild(messageDiv);
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
