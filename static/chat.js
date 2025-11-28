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
let currentXhr = null; // Store jQuery XHR object to allow abortion

// --- DOM Elements (using jQuery Selectors for consistency, though vanilla works too) ---
const chatContainer = $('#chat-container');
const userInput = $('#user-input');
const sendBtn = $('#send-btn');
const resetBtn = $('#reset-chat-btn');
const loadingState = $('#loading-state');
const cancelBtn = $('#cancel-btn');
const indexFreshnessEl = $('#index-freshness');

// Settings Inputs
const optTopK = $('#opt-topk');
const optTokens = $('#opt-tokens');
const optTemp = $('#opt-temp');
const optRaw = $('#opt-raw');

// --- Initialization ---
$(document).ready(function() {
    fetchStatus();
    
    // Sync Range Inputs
    optTopK.on('input', function() { $('#val-topk').text($(this).val()); });
    optTemp.on('input', function() { $('#val-temp').text($(this).val()); });

    // Textarea Auto-resize
    userInput.on('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if(this.value === '') this.style.height = '50px';
    });

    // Enter to send
    userInput.on('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitMessage();
        }
    });

    sendBtn.on('click', submitMessage);
    resetBtn.on('click', resetChat);
    
    cancelBtn.on('click', function() {
        if (currentXhr) {
            currentXhr.abort(); // jQuery abort
        }
    });
});

async function fetchStatus() {
    try {
        const data = await $.ajax({ url: '/api/status', type: 'GET' });
        
        if(data.last_trained_at) {
            const date = new Date(data.last_trained_at);
            indexFreshnessEl.text(date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
            indexFreshnessEl.attr('title', `${data.vectors_indexed} vectors indexed`);
            indexFreshnessEl.addClass("text-green-600");
        } else {
            indexFreshnessEl.text("Not indexed");
            indexFreshnessEl.addClass("text-red-500");
        }
    } catch(e) {
        indexFreshnessEl.text("Offline");
    }
}

// --- Core Logic ---

async function submitMessage() {
    const text = userInput.val().trim();
    if (!text || isGenerating) return;

    // 1. UI Updates
    userInput.val('');
    userInput.css('height', '50px');
    appendUserMessage(text);
    startLoadingUI();

    // 2. Prepare Request
    const payload = {
        question: text,
        client_id: clientId,
        top_k: parseInt(optTopK.val()),
        max_tokens: parseInt(optTokens.val()),
        temperature: parseFloat(optTemp.val()),
        show_raw: optRaw.is(':checked')
    };

    try {
        // 3. API Call using $.ajax
        // We assign the promise to currentXhr so we can call .abort() on it
        currentXhr = $.ajax({
            url: '/api/chat',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload)
        });

        const data = await currentXhr;
        
        // 4. Render Response
        stopLoadingUI();
        await typeWriterEffect(data.answer, data.sources);

    } catch (error) {
        stopLoadingUI();
        if (error.statusText === 'abort') {
             appendSystemMessage("Generation stopped by user.");
        } else {
             appendSystemMessage("Error: " + (error.responseText || "Network error"));
        }
    } finally {
        currentXhr = null;
    }
}

async function resetChat() {
    if(!confirm("Clear chat history?")) return;
    chatContainer.empty(); // Keep welcome? optional.
    
    try {
        await $.ajax({ 
            url: `/api/reset?client_id=${clientId}`, 
            type: 'POST' 
        });
        window.location.reload();
    } catch(e) {
        console.error("Reset failed");
    }
}

// --- Rendering Functions ---

function appendUserMessage(text) {
    const div = $(`
        <div class="flex gap-4 max-w-3xl mx-auto justify-end fade-in">
            <div class="bg-blue-600 text-white rounded-2xl rounded-tr-none p-4 shadow-sm text-sm">
                <p class="whitespace-pre-wrap">${escapeHtml(text)}</p>
            </div>
            <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0">
                <i class="fa-solid fa-user"></i>
            </div>
        </div>
    `);
    chatContainer.append(div);
    scrollToBottom();
}

function createBotMessageContainer() {
    const div = $(`
        <div class="flex gap-4 max-w-3xl mx-auto fade-in">
            <div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0 mt-1">
                <i class="fa-solid fa-robot"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="bg-white border border-gray-200 rounded-2xl rounded-tl-none p-4 shadow-sm text-sm text-gray-800 prose max-w-none message-content">
                    <span class="cursor-blink"></span>
                </div>
                <div class="sources-container mt-2 space-y-2 hidden"></div>
            </div>
        </div>
    `);
    chatContainer.append(div);
    return div; // Return jQuery object
}

async function typeWriterEffect(text, sources) {
    const container = createBotMessageContainer();
    const contentDiv = container.find('.message-content');
    
    let i = 0;
    const speed = 10; 
    
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (i < text.length) {
                // We access the DOM node inside jQuery object with [0] or .text() logic
                // For simple append:
                contentDiv.text(contentDiv.text() + text.charAt(i));
                i++;
                scrollToBottom();
            } else {
                clearInterval(interval);
                // Render Final Markdown
                contentDiv.html(marked.parse(text));
                // Render Sources
                if (sources && sources.length > 0) {
                    renderSources(container.find('.sources-container'), sources);
                }
                resolve();
            }
        }, speed);
    });
}

function renderSources(container, sources) {
    container.removeClass('hidden');
    
    container.append('<p class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Sources</p>');

    $.each(sources, function(idx, src) {
        const snippet = src.text.length > 80 ? src.text.substring(0, 80) + "..." : src.text;
        
        const btn = $(`
            <button class="block w-full text-left text-xs bg-white border border-gray-200 hover:border-blue-400 hover:shadow-sm rounded-md p-2 transition group">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-semibold text-blue-600 group-hover:underline"><i class="fa-regular fa-file-pdf mr-1"></i> ${src.file} (pg ${src.page})</span>
                    <span class="bg-gray-100 text-gray-600 px-1.5 rounded text-[10px]">Score: ${src.score}</span>
                </div>
                <p class="text-gray-500 truncate">${snippet}</p>
            </button>
        `);
        
        btn.on('click', () => openSourceModal(src));
        container.append(btn);
    });
    scrollToBottom();
}

function appendSystemMessage(msg) {
    const div = $(`<div class="text-center text-xs text-gray-400 my-4 italic"></div>`).text(msg);
    chatContainer.append(div);
    scrollToBottom();
}

// --- UI State Helpers ---

function startLoadingUI() {
    isGenerating = true;
    sendBtn.prop('disabled', true);
    loadingState.removeClass('hidden');
    
    const tempDiv = $(`
        <div id="temp-spinner" class="flex gap-4 max-w-3xl mx-auto fade-in">
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
        </div>
    `);
    chatContainer.append(tempDiv);
    scrollToBottom();
}

function stopLoadingUI() {
    isGenerating = false;
    sendBtn.prop('disabled', false);
    loadingState.addClass('hidden');
    $('#temp-spinner').remove();
}

function scrollToBottom() {
    chatContainer.scrollTop(chatContainer[0].scrollHeight);
}

function escapeHtml(text) {
    return $('<div>').text(text).html();
}

// --- Modal Logic ---
const modal = $('#source-modal');

function openSourceModal(src) {
    $('#modal-filename').text(src.file);
    $('#modal-page').text(src.page);
    $('#modal-score').text(src.score);
    $('#modal-content').text(src.text);
    $('#modal-download').attr('href', `/files/view/${src.file}#page=${src.page}`);
    
    modal.removeClass('hidden');
}

window.closeModal = () => {
    modal.addClass('hidden');
}

modal.on('click', function(e) {
    if ($(e.target).is(modal)) {
        closeModal();
    }
});