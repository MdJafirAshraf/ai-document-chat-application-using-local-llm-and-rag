// --- Client ID Management ---
function getClientId() {
    let id = localStorage.getItem('rag_client_id');
    if (!id) {
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('rag_client_id', id);
    }
    return id;
}

const clientId = getClientId();
let isGenerating = false;
let abortController = null;

// --- DOM Elements ---
const chatContainer = document.getElementById('chat-container');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const resetBtn = document.getElementById('reset-chat-btn');
const loadingState = document.getElementById('loading-state');
const cancelBtn = document.getElementById('cancel-btn');
const indexFreshnessEl = document.getElementById('index-freshness');

// Settings Inputs
const optTopK = document.getElementById('opt-topk');
const optTokens = document.getElementById('opt-tokens');
const optTemp = document.getElementById('opt-temp');
const optRaw = document.getElementById('opt-raw');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    fetchStatus();
    
    // Sync Range Inputs
    optTopK.addEventListener('input', (e) => document.getElementById('val-topk').textContent = e.target.value);
    optTemp.addEventListener('input', (e) => document.getElementById('val-temp').textContent = e.target.value);

    // Textarea Auto-resize
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if(this.value === '') this.style.height = '50px';
    });

    // Enter to send (Shift+Enter for new line)
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitMessage();
        }
    });

    sendBtn.addEventListener('click', submitMessage);
    resetBtn.addEventListener('click', resetChat);
    cancelBtn.addEventListener('click', () => {
        if (abortController) abortController.abort();
        stopLoadingUI();
        appendSystemMessage("Generation stopped by user.");
    });
});

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if(data.last_trained_at) {
            const date = new Date(data.last_trained_at);
            indexFreshnessEl.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            indexFreshnessEl.title = `${data.vectors_indexed} vectors indexed`;
            indexFreshnessEl.classList.add("text-green-600");
        } else {
            indexFreshnessEl.textContent = "Not indexed";
            indexFreshnessEl.classList.add("text-red-500");
        }
    } catch(e) {
        indexFreshnessEl.textContent = "Offline";
    }
}

// --- Core Logic ---

async function submitMessage() {
    const text = userInput.value.trim();
    if (!text || isGenerating) return;

    // 1. UI Updates
    userInput.value = '';
    userInput.style.height = '50px';
    appendUserMessage(text);
    startLoadingUI();

    // 2. Prepare Request
    const payload = {
        question: text,
        client_id: clientId,
        top_k: parseInt(optTopK.value),
        max_tokens: parseInt(optTokens.value),
        temperature: parseFloat(optTemp.value),
        show_raw: optRaw.checked
    };

    abortController = new AbortController();

    try {
        // 3. API Call
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: abortController.signal
        });

        if (!response.ok) throw new Error("Network response was not ok");

        const data = await response.json();
        
        // 4. Render Response (Simulate streaming effect visually)
        stopLoadingUI();
        await typeWriterEffect(data.answer, data.sources);

    } catch (error) {
        if (error.name === 'AbortError') return; // Handled by cancel button
        stopLoadingUI();
        appendSystemMessage("Error: " + error.message);
    }
}

async function resetChat() {
    if(!confirm("Clear chat history?")) return;
    chatContainer.innerHTML = ''; // Keep welcome? optional.
    await fetch(`/api/reset?client_id=${clientId}`, { method: 'POST' });
    window.location.reload();
}

// --- Rendering Functions ---

function appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = "flex gap-4 max-w-3xl mx-auto justify-end fade-in";
    div.innerHTML = `
        <div class="bg-blue-600 text-white rounded-2xl rounded-tr-none p-4 shadow-sm text-sm">
            <p class="whitespace-pre-wrap">${escapeHtml(text)}</p>
        </div>
        <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0">
            <i class="fa-solid fa-user"></i>
        </div>
    `;
    chatContainer.appendChild(div);
    scrollToBottom();
}

function createBotMessageContainer() {
    const div = document.createElement('div');
    div.className = "flex gap-4 max-w-3xl mx-auto fade-in";
    div.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0 mt-1">
            <i class="fa-solid fa-robot"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="bg-white border border-gray-200 rounded-2xl rounded-tl-none p-4 shadow-sm text-sm text-gray-800 prose max-w-none message-content">
                <span class="cursor-blink"></span>
            </div>
            <div class="sources-container mt-2 space-y-2 hidden"></div>
        </div>
    `;
    chatContainer.appendChild(div);
    return div;
}

async function typeWriterEffect(text, sources) {
    const container = createBotMessageContainer();
    const contentDiv = container.querySelector('.message-content');
    
    // Simulate Streaming
    // In a real app, you'd read the stream chunk by chunk.
    // Here we fake it by splitting the string.
    let i = 0;
    const speed = 10; // ms per char
    
    // Parse Markdown initially but reveal strictly
    // NOTE: Simple typing effect on HTML is hard. 
    // Strategy: We will type plain text, then swap to Marked HTML at the end to prevent broken tags.
    
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (i < text.length) {
                contentDiv.textContent += text.charAt(i);
                i++;
                scrollToBottom();
            } else {
                clearInterval(interval);
                // Render Final Markdown
                contentDiv.innerHTML = marked.parse(text);
                // Render Sources
                if (sources && sources.length > 0) {
                    renderSources(container.querySelector('.sources-container'), sources);
                }
                resolve();
            }
        }, speed);
    });
}

function renderSources(container, sources) {
    container.classList.remove('hidden');
    
    const label = document.createElement('p');
    label.className = "text-xs font-bold text-gray-400 uppercase tracking-wider mb-1";
    label.textContent = "Sources";
    container.appendChild(label);

    sources.forEach((src, idx) => {
        const btn = document.createElement('button');
        btn.className = "block w-full text-left text-xs bg-white border border-gray-200 hover:border-blue-400 hover:shadow-sm rounded-md p-2 transition group";
        
        // Truncate text for preview
        const snippet = src.text.length > 80 ? src.text.substring(0, 80) + "..." : src.text;
        
        btn.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-semibold text-blue-600 group-hover:underline"><i class="fa-regular fa-file-pdf mr-1"></i> ${src.file} (pg ${src.page})</span>
                <span class="bg-gray-100 text-gray-600 px-1.5 rounded text-[10px]">Score: ${src.score}</span>
            </div>
            <p class="text-gray-500 truncate">${snippet}</p>
        `;
        
        btn.onclick = () => openSourceModal(src);
        container.appendChild(btn);
    });
    scrollToBottom();
}

function appendSystemMessage(msg) {
    const div = document.createElement('div');
    div.className = "text-center text-xs text-gray-400 my-4 italic";
    div.textContent = msg;
    chatContainer.appendChild(div);
    scrollToBottom();
}

// --- UI State Helpers ---

function startLoadingUI() {
    isGenerating = true;
    sendBtn.disabled = true;
    loadingState.classList.remove('hidden');
    
    // Add a temporary spinner bubble
    const tempDiv = document.createElement('div');
    tempDiv.id = "temp-spinner";
    tempDiv.className = "flex gap-4 max-w-3xl mx-auto fade-in";
    tempDiv.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0">
            <i class="fa-solid fa-robot"></i>
        </div>
        <div class="bg-white border border-gray-200 rounded-2xl rounded-tl-none p-4 shadow-sm flex items-center">
            <div class="flex space-x-1">
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
                <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.4s"></div>
            </div>
        </div>
    `;
    chatContainer.appendChild(tempDiv);
    scrollToBottom();
}

function stopLoadingUI() {
    isGenerating = false;
    sendBtn.disabled = false;
    loadingState.classList.add('hidden');
    const temp = document.getElementById('temp-spinner');
    if(temp) temp.remove();
}

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Modal Logic ---
const modal = document.getElementById('source-modal');
const modalFilename = document.getElementById('modal-filename');
const modalPage = document.getElementById('modal-page');
const modalScore = document.getElementById('modal-score');
const modalContent = document.getElementById('modal-content');
const modalDownload = document.getElementById('modal-download');

function openSourceModal(src) {
    modalFilename.textContent = src.file;
    modalPage.textContent = src.page;
    modalScore.textContent = src.score;
    modalContent.textContent = src.text; // In real app, fetch full chunk text if truncated
    modalDownload.href = `/files/view/${src.file}#page=${src.page}`;
    
    modal.classList.remove('hidden');
}

window.closeModal = () => {
    modal.classList.add('hidden');
}

// Close modal on outside click
modal.addEventListener('click', (e) => {
    if(e.target === modal) closeModal();
});