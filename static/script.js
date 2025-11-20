document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListEl = document.getElementById('file-list');
    const filesSection = document.getElementById('files-section');
    const trainBtn = document.getElementById('train-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressLabel = document.getElementById('progress-label');
    const progressPercent = document.getElementById('progress-percent');
    
    // Initialization
    fetchFiles();
    fetchInfo();
    checkTrainingStatus(); // Poll immediately in case page was refreshed during training

    // --- Drag & Drop Logic ---
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
    fileInput.addEventListener('change', handleFilesSelect, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    function handleFilesSelect(e) {
        const files = e.target.files;
        handleFiles(files);
    }

    function handleFiles(files) {
        const formData = new FormData();
        let validFiles = false;
        
        ([...files]).forEach(file => {
            if (file.type === 'application/pdf') {
                formData.append('files', file);
                validFiles = true;
            }
        });

        if (validFiles) {
            uploadFiles(formData);
        } else {
            alert("Please upload PDF files only.");
        }
    }

    // --- API Calls ---

    async function uploadFiles(formData) {
        // UI indicating upload start
        dropZone.innerHTML = `<div class="text-blue-600"><i class="fa-solid fa-circle-notch fa-spin text-2xl"></i><p class="mt-2">Uploading...</p></div>`;
        
        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            fetchFiles(); // Refresh list
            fetchInfo();  // Update stats
        } catch (error) {
            console.error('Error uploading:', error);
        } finally {
            // Reset Dropzone
            setTimeout(() => {
                dropZone.innerHTML = `
                    <input type="file" id="file-input" class="hidden" multiple accept="application/pdf">
                    <div class="mb-4"><i class="fa-solid fa-cloud-arrow-up text-4xl text-gray-300"></i></div>
                    <h3 class="text-lg font-semibold text-gray-700 mb-2">Drag & Drop PDFs here</h3>
                    <p class="text-gray-500 text-sm mb-4">or click to browse files</p>
                    <button onclick="document.getElementById('file-input').click()" class="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition">Browse Files</button>
                `;
                // Re-attach listener to new button
                document.getElementById('file-input').addEventListener('change', handleFilesSelect);
            }, 500);
        }
    }

    async function fetchFiles() {
        const response = await fetch('/files');
        const files = await response.json();
        
        // Update Badge
        document.getElementById('file-count-badge').textContent = `${files.length} files`;
        
        // Update List
        fileListEl.innerHTML = '';
        if (files.length > 0) {
            filesSection.classList.remove('hidden');
            trainBtn.disabled = false;
            files.forEach(file => {
                const li = document.createElement('li');
                li.className = 'p-4 flex items-center justify-between hover:bg-gray-50 transition fade-in';
                li.innerHTML = `
                    <div class="flex items-center gap-4">
                        <div class="text-red-500 bg-red-50 p-2 rounded">
                            <i class="fa-regular fa-file-pdf text-xl"></i>
                        </div>
                        <div>
                            <p class="font-medium text-gray-800 text-sm truncate w-64" title="${file.filename}">${file.filename}</p>
                            <p class="text-xs text-gray-500">${file.pages} pages • ${file.size}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <a href="/files/view/${file.filename}" target="_blank" class="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition" title="Preview">
                            <i class="fa-regular fa-eye"></i>
                        </a>
                        <button onclick="deleteFile('${file.filename}')" class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition" title="Remove">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                `;
                fileListEl.appendChild(li);
            });
        } else {
            filesSection.classList.add('hidden');
            trainBtn.disabled = true;
        }
    }

    window.deleteFile = async (filename) => {
        if(!confirm(`Remove ${filename}?`)) return;
        await fetch(`/files/${filename}`, { method: 'DELETE' });
        fetchFiles();
        fetchInfo();
    };

    async function fetchInfo() {
        const res = await fetch('/info');
        const data = await res.json();
        
        document.getElementById('info-pdf-count').textContent = data.pdf_count;
        document.getElementById('info-vectors').textContent = data.vectors_indexed;
        document.getElementById('info-last-trained').textContent = data.last_trained_at || "Never";
        document.getElementById('info-model-emb').textContent = data.embedding_model;
        document.getElementById('info-model-llm').textContent = data.llm_model;
    }

    // --- Training Logic ---
    
    trainBtn.addEventListener('click', async () => {
        trainBtn.disabled = true;
        const res = await fetch('/train', { method: 'POST' });
        if(res.ok) {
            pollTrainingStatus();
        }
    });

    async function checkTrainingStatus() {
        // Initial check on load
        const res = await fetch('/train/status');
        const state = await res.json();
        if (state.is_training) {
            pollTrainingStatus();
        }
    }

    function pollTrainingStatus() {
        progressContainer.classList.remove('hidden');
        trainBtn.disabled = true;
        trainBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;

        const interval = setInterval(async () => {
            const res = await fetch('/train/status');
            const state = await res.json();

            // Update UI
            progressBar.style.width = `${state.progress}%`;
            progressLabel.textContent = state.stage;
            progressPercent.textContent = `${state.progress}%`;

            if (!state.is_training) {
                clearInterval(interval);
                // Finished
                setTimeout(() => {
                    progressContainer.classList.add('hidden');
                    trainBtn.disabled = false;
                    trainBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Train / Index Documents`;
                    fetchInfo(); // Refresh last trained timestamp
                    alert(state.message);
                }, 1000);
            }
        }, 1000);
    }
});