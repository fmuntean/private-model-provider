// main.js – minimal vanilla JS chat UI
const vscode = acquireVsCodeApi();

const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const modelSelect = document.getElementById('model-select');

// Notify extension that webview is ready
console.log('[LMP] Webview JS loaded, sending webviewReady...');
vscode.postMessage({ command: 'webviewReady' });

// Store available models
let availableModels = [];
let defaultModel = '';

function addMessage(author, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${author}`;
    msgDiv.textContent = text;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function populateModelSelect(models, defaultModelId) {
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
        if (model.id === defaultModelId) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
    });
}

let currentRequestId = null;

function stopRequest() {
    if (currentRequestId) {
        vscode.postMessage({
            command: 'stopRequest',
            requestId: currentRequestId
        });
        currentRequestId = null;
        stopBtn.style.display = 'none';
        sendBtn.disabled = false;
    }
}

sendBtn.addEventListener('click', () => {
    const text = userInput.value.trim();
    if (!text) return;

    const selectedModel = modelSelect.value;
    addMessage('user', text);
    currentRequestId = Date.now().toString();
    vscode.postMessage({
        command: 'sendMessage',
        text,
        model: selectedModel,
        requestId: currentRequestId
    });
    userInput.value = '';
    // Only show stop button if we have a valid model
    if (selectedModel) {
        stopBtn.style.display = 'inline-block';
        sendBtn.disabled = true;
    }
});

stopBtn.addEventListener('click', () => {
    console.log('[LMP] Stop button clicked');
    stopRequest();
});

// Receive messages from extension
window.addEventListener('message', event => {
    const msg = event.data;

    if (msg.type === 'models') {
        // Receive available models from extension
        availableModels = msg.models || [];
        defaultModel = msg.defaultModel || '';
        populateModelSelect(availableModels, defaultModel);
    } else if (msg.type === 'assistant-chunk') {
        // Streaming chunk - append to last assistant message or create new one
        let lastMsg = chatContainer.lastElementChild;
        if (lastMsg && lastMsg.classList.contains('assistant') && lastMsg.dataset.streaming === 'true') {
            // Append to existing streaming message
            lastMsg.textContent += msg.content;
        } else {
            // Create new message for streaming
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message assistant';
            msgDiv.dataset.streaming = 'true';
            msgDiv.textContent = msg.content;
            chatContainer.appendChild(msgDiv);
        }
        chatContainer.scrollTop = chatContainer.scrollHeight;
    } else if (msg.type === 'assistant-done') {
        // Streaming complete - mark last message as complete
        let lastMsg = chatContainer.lastElementChild;
        if (lastMsg && lastMsg.classList.contains('assistant') && lastMsg.dataset.streaming === 'true') {
            delete lastMsg.dataset.streaming;
        }
        // Display token usage if available (as part of the chat)
        if (msg.usage) {
            const usageDiv = document.createElement('div');
            usageDiv.className = 'message info';
            usageDiv.textContent = `Tokens used: ${msg.usage.total_tokens}`;
            chatContainer.appendChild(usageDiv);
        }
        // Reset stop button
        currentRequestId = null;
        stopBtn.style.display = 'none';
        sendBtn.disabled = false;
    } else if (msg.type === 'error') {
        addMessage('error', msg.error);
    } else if (msg.type === 'request-stopped') {
        // Request was stopped by user
        let lastMsg = chatContainer.lastElementChild;
        if (lastMsg && lastMsg.classList.contains('assistant') && lastMsg.dataset.streaming === 'true') {
            delete lastMsg.dataset.streaming;
            lastMsg.textContent += ' [Stopped]';
        }
        // Reset stop button
        currentRequestId = null;
        stopBtn.style.display = 'none';
        sendBtn.disabled = false;
    }
});

// Models will be requested when webview is ready

// Optional: request stats on load
vscode.postMessage({ command: 'requestStats' });
