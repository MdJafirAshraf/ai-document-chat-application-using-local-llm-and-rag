import os
from PyPDF2 import PdfReader
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)


# Render pages

@app.route('/')
def upload():
    return render_template('upload.html')


@app.route('/chat')
def chat():
    return render_template('chat.html')
    

# --- API Endpoints ---

UPLOAD_DIR = "static/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

CONFIG_INFO = {
    "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
    "llm_model": "llama2-7b-chat.gguf",
    "last_trained_at": None,
    "vectors_indexed": 0
}

def get_pdf_page_count(filepath):
    try:
        reader = PdfReader(filepath)
        return len(reader.pages)
    except Exception:
        return 0

def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} TB"


@app.route('/upload', methods=['POST'])
def upload_files():
    if 'files' not in request.files:
        return jsonify({"error": "No files part"}), 400
    
    files = request.files.getlist('files')
    uploaded_details = []
    
    for file in files:
        if file.filename == '':
            continue

        if file.filename.lower().endswith('.pdf'):
            file_path = os.path.join(UPLOAD_DIR, file.filename)
            file.save(file_path)
            
            uploaded_details.append({
                "filename": file.filename,
                "pages": get_pdf_page_count(file_path),
                "size": format_size(os.path.getsize(file_path))
            })
            
    return jsonify(uploaded_details)

@app.route('/info', methods=['GET'])
def get_index_info():
    pdf_count = 0
    if os.path.exists(UPLOAD_DIR):
        pdf_count = len([f for f in os.listdir(UPLOAD_DIR) if f.lower().endswith('.pdf')])
    
    return jsonify({
        "pdf_count": pdf_count,
        "embedding_model": CONFIG_INFO["embedding_model"],
        "llm_model": CONFIG_INFO["llm_model"],
        "last_trained_at": CONFIG_INFO["last_trained_at"],
        "vectors_indexed": CONFIG_INFO["vectors_indexed"]
    })

@app.route('/files', methods=['GET'])
def list_files():
    files_data = []
    if os.path.exists(UPLOAD_DIR):
        for filename in os.listdir(UPLOAD_DIR):
            filepath = os.path.join(UPLOAD_DIR, filename)
            if os.path.isfile(filepath) and filename.lower().endswith('.pdf'):
                stat = os.stat(filepath)
                files_data.append({
                    "filename": filename,
                    "size": format_size(stat.st_size),
                    "pages": get_pdf_page_count(filepath)
                })
    return jsonify(files_data)




if __name__ == '__main__':
    app.run(debug=True)