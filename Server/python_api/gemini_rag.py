# project-root/Server/python_api/gemini_rag.py
from flask import Flask, request, jsonify
import os
import google.generativeai as genai
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np
import json
from flask_cors import CORS
import logging
from dotenv import load_dotenv
import mimetypes # Import mimetypes to determine file type

# NEW IMPORTS for document upload and advanced chunking
from werkzeug.utils import secure_filename # For secure filenames
import pypdf # For PDF parsing
from langchain_text_splitters import RecursiveCharacterTextSplitter # For LangChain chunking

# --- Configure Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Load Environment Variables ---
load_dotenv()

# --- FLASK APP INITIALIZATION ---
app = Flask(__name__)
CORS(app)

# --- DIRECTORY PATHS ---
DOCUMENTS_DIR = "documents"
VECTORSTORE_DIR = "vectorstore"
FAISS_INDEX_PATH = os.path.join(VECTORSTORE_DIR, "index.faiss")
DOCUMENTS_LIST_PATH = os.path.join(VECTORSTORE_DIR, "documents.json")
# NEW: Directory for user-uploaded documents
USER_UPLOAD_DIR = "user_uploaded_docs"

# Ensure directories exist
os.makedirs(DOCUMENTS_DIR, exist_ok=True)
os.makedirs(VECTORSTORE_DIR, exist_ok=True)
os.makedirs(USER_UPLOAD_DIR, exist_ok=True) # Ensure user upload directory exists

# --- GLOBAL VARIABLES FOR RAG COMPONENTS ---
embedder = None
documents = [] # Stores the text chunks
faiss_index = None
gemini_model = None # Initialized globally after configuration

# --- FUNCTION TO CONFIGURE GEMINI API & MODEL ---
def configure_gemini():
    global gemini_model
    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        logging.error("CRITICAL ERROR: GEMINI_API_KEY environment variable not set. AI functionalities will not work.")
        return False
    try:
        genai.configure(api_key=api_key)
        # Using gemini-1.5-flash-latest which supports multimodal input
        gemini_model = genai.GenerativeModel('gemini-1.5-flash-latest')
        logging.info("Gemini API and model configured successfully.")
        return True
    except Exception as e:
        logging.error(f"Error configuring Gemini API or loading model: {e}")
        gemini_model = None
        return False

# --- FUNCTION TO LOAD OR CREATE VECTOR STORE ---
def load_or_create_vectorstore():
    global embedder, documents, faiss_index

    if embedder is None:
        logging.info("Loading SentenceTransformer model...")
        embedder = SentenceTransformer("all-MiniLM-L6-v2") # Using SentenceTransformer
        logging.info("SentenceTransformer model loaded.")

    if os.path.exists(FAISS_INDEX_PATH) and os.path.exists(DOCUMENTS_LIST_PATH):
        logging.info("Attempting to load existing FAISS index and documents...")
        try:
            faiss_index = faiss.read_index(FAISS_INDEX_PATH)
            with open(DOCUMENTS_LIST_PATH, "r", encoding="utf-8") as f:
                documents = json.load(f)
            logging.info(f"Loaded {len(documents)} document chunks and FAISS index from disk.")
            # Verify index dimension matches embedder
            if faiss_index.d != embedder.get_sentence_embedding_dimension():
                logging.warning("FAISS index dimension mismatch with current embedder. Rebuilding from sample.txt...")
                rebuild_vectorstore_from_sample()
        except Exception as e:
            logging.error(f"Error loading existing vector store: {e}. Rebuilding from sample.txt as a fallback...")
            rebuild_vectorstore_from_sample()
    else:
        logging.info("Vector store not found. Creating new vector store from sample.txt...")
        rebuild_vectorstore_from_sample()

# Renamed from rebuild_vectorstore to specifically handle sample.txt
def rebuild_vectorstore_from_sample():
    global documents, faiss_index, embedder

    sample_doc_path = os.path.join(DOCUMENTS_DIR, "sample.txt")

    if not os.path.exists(sample_doc_path):
        logging.info(f"'{sample_doc_path}' not found. Creating a sample document for demonstration.")
        with open(sample_doc_path, "w", encoding="utf-8") as f:
            f.write("A contract is a legally binding agreement between two or more parties. For a contract to be valid and enforceable, several essential elements must generally be present. These include: Offer, Acceptance, Consideration, Mutual Assent, Legal Capacity, and Lawful Object. Contracts can be written, oral, or implied by conduct. However, some types of contracts, such as those involving real estate or those that cannot be performed within one year, may be required by law (Statute of Frauds) to be in writing to be enforceable. Breach of contract occurs when one party fails to fulfill their obligations as specified in the agreement, which can lead to remedies such as damages or specific performance.\n\n")
            f.write("In tort law, negligence is a legal theory under which a person can be held liable for injuries to another person caused by their failure to exercise reasonable care. To prove negligence, a plaintiff typically must establish four key elements: Duty of Care, Breach of Duty, Causation, and Damages. Defenses to negligence claims can include contributory negligence or assumption of risk.\n\n")
            f.write("Copyright law grants creators of original works of authorship exclusive rights to their works, such as books, music, and films. Protection arises automatically once an original work is fixed in a tangible medium. Exclusive rights include reproduction, distribution, performance, and display. Limitations like 'fair use' allow certain uses without permission. The duration of copyright typically lasts for the life of the author plus 70 years.\n\n")
            f.write("A car, or automobile, is a wheeled motor vehicle used for transportation.\n\n")
            f.write("Retrieval-Augmented Generation (RAG) is an AI framework that retrieves facts from an external knowledge base to ground large language models (LLMs) on authoritative sources and prevent hallucination.\n\n")
            f.write("MongoDB is a popular NoSQL database that uses JSON-like documents with optional schemas.\n\n")
            f.write("React is a free and open-source front-end JavaScript library for building user interfaces based on components.\n\n")
            f.write("FAISS (Facebook AI Similarity Search) is a library for efficient similarity search and clustering of dense vectors.\n\n")
        logging.info(f"Sample '{sample_doc_path}' created.")

    with open(sample_doc_path, "r", encoding="utf-8") as f:
        raw_text = f.read()

    # Use LangChain's RecursiveCharacterTextSplitter for sample.txt
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500, # Adjust based on your typical document and desired context
        chunk_overlap=100, # Overlap helps maintain context between chunks
        length_function=len,
        separators=["\n\n", "\n", " ", ""] # Common separators for better chunking
    )
    documents = text_splitter.split_text(raw_text)

    if not documents:
        logging.warning("No documents loaded from 'sample.txt'. RAG system will not function as expected.")
        if embedder is not None:
            faiss_index = faiss.IndexFlatL2(embedder.get_sentence_embedding_dimension())
        else:
            logging.error("Embedder not initialized, cannot create empty FAISS index.")
            faiss_index = None
    else:
        logging.info(f"Embedding {len(documents)} document chunks from sample.txt...")
        doc_embeddings = embedder.encode(documents, convert_to_numpy=True)
        logging.info("Embeddings created. Building FAISS index...")
        faiss_index = faiss.IndexFlatL2(doc_embeddings.shape[1])
        faiss_index.add(doc_embeddings)
        logging.info("FAISS index built.")

        # Save the FAISS index and the document chunks for persistence
        faiss.write_index(faiss_index, FAISS_INDEX_PATH)
        with open(DOCUMENTS_LIST_PATH, "w", encoding="utf-8") as f:
            json.dump(documents, f)
        logging.info(f"Vector store with {len(documents)} document chunks saved to '{VECTORSTORE_DIR}'.")

# --- INITIALIZATION CALLS ---
# This block ensures that embedder is loaded and vector store is ready on startup
if configure_gemini(): # Only proceed if Gemini is configured successfully
    load_or_create_vectorstore()
else:
    logging.error("Gemini API not configured. RAG and direct AI calls will fail.")

# --- RETRIEVAL FUNCTION ---
def retrieve_chunks(query, top_k=3):
    global embedder # Ensure embedder is accessible

    if embedder is None or faiss_index is None or not documents:
        logging.warning("RAG system not fully initialized or no documents. Cannot retrieve chunks.")
        return []

    try:
        q_emb = embedder.encode([query], convert_to_numpy=True) # Using SentenceTransformer embedder

        if q_emb.shape[1] != faiss_index.d:
            logging.error(f"Error: Query embedding dimension ({q_emb.shape[1]}) does not match index dimension ({faiss_index.d}). Rebuilding index might be necessary if model changed.")
            return []

        actual_top_k = min(top_k, len(documents))
        if actual_top_k == 0:
            logging.info("No documents to retrieve from.")
            return []

        _, indices = faiss_index.search(q_emb, actual_top_k)
        retrieved_chunks = [documents[i] for i in indices[0]]
        return retrieved_chunks
    except Exception as e:
        logging.error(f"Error during chunk retrieval: {e}", exc_info=True)
        return []

# --- API ROUTE FOR CHAT (no significant changes here, multimodal handling logic remains) ---
@app.route("/gemini-rag", methods=["POST"])
def rag_chat():
    global gemini_model

    prompt = None
    file_part = None # To hold the Generative Part for multimodal input

    # Determine content type of the request
    content_type = request.headers.get('Content-Type', '')
    logging.info(f"Incoming request Content-Type: {content_type}")
    print(f"DEBUG: Incoming request Content-Type: {content_type}") # Console log

    if content_type.startswith('application/json'):
        # Handle JSON requests (for text-only prompts)
        try:
            data = request.get_json()
            prompt = data.get("prompt")
            print(f"DEBUG: Received JSON data: {json.dumps(data)}") # Console log
            if not prompt:
                print("DEBUG: Prompt is missing in JSON payload.") # Console log
                return jsonify({"error": "Prompt is required in JSON payload"}), 400
            logging.info("Received JSON request.")
        except Exception as e:
            logging.error(f"Error parsing JSON request: {e}")
            print(f"DEBUG: Error parsing JSON request: {e}") # Console log
            return jsonify({"error": "Invalid JSON payload"}), 400
    elif content_type.startswith('multipart/form-data'):
        # Handle form-data requests (for prompts with files)
        prompt = request.form.get("prompt")
        uploaded_file = request.files.get("file")

        print(f"DEBUG: Received form data - Prompt: '{prompt}', File: '{uploaded_file.filename if uploaded_file else 'None'}'") # Console log

        if not prompt:
            if not uploaded_file:
                print("DEBUG: Prompt is missing and no file uploaded in multipart request.") # Console log
                return jsonify({"error": "Prompt is required when no file is uploaded"}), 400
            else:
                prompt = "" # Allow empty prompt if file is present (e.g., "describe this image")
                print("DEBUG: Empty prompt allowed because a file is present.") # Console log

        if uploaded_file:
            filename = uploaded_file.filename
            uploaded_file_mime_type = mimetypes.guess_type(filename)[0] or uploaded_file.mimetype
            logging.info(f"Received file: {filename} ({uploaded_file_mime_type})")
            print(f"DEBUG: Processing uploaded file: {filename}, MIME type: {uploaded_file_mime_type}") # Console log

            if uploaded_file_mime_type and uploaded_file_mime_type.startswith('image/'):
                try:
                    file_bytes = uploaded_file.read()
                    file_part = {
                        'mime_type': uploaded_file_mime_type,
                        'data': file_bytes
                    }
                    logging.info(f"Image file '{filename}' converted to Generative Part.")
                    print(f"DEBUG: Image file '{filename}' read. Size: {len(file_bytes)} bytes.") # Console log
                except Exception as e:
                    logging.error(f"Error processing image file '{filename}': {e}")
                    print(f"DEBUG: Error processing image file '{filename}': {e}") # Console log
                    return jsonify({"error": f"Error processing image file: {e}"}), 400
            elif uploaded_file_mime_type and uploaded_file_mime_type.startswith('text/'):
                try:
                    file_content = uploaded_file.read().decode('utf-8')
                    # Directly append text file content to prompt for Gemini to use as context
                    prompt = f"{prompt}\n\nAdditional context from uploaded file '{filename}':\n{file_content}"
                    logging.info(f"Text file '{filename}' content incorporated into prompt.")
                    print(f"DEBUG: Text file '{filename}' content incorporated into prompt. New prompt length: {len(prompt)}") # Console log
                except Exception as e:
                    logging.error(f"Error reading text file '{filename}': {e}")
                    print(f"DEBUG: Error reading text file '{filename}': {e}") # Console log
                    return jsonify({"error": f"Error processing text file: {e}"}), 400
            else:
                logging.warning(f"Unsupported file type for direct RAG or multimodal processing in /gemini-rag: {uploaded_file_mime_type}. File will be ignored for enhanced context.")
                print(f"DEBUG: Unsupported file type '{uploaded_file_mime_type}'. File ignored for /gemini-rag context.") # Console log
        logging.info("Received multipart/form-data request.")
    else:
        print("DEBUG: Unsupported content type detected.") # Console log
        return jsonify({"error": "Unsupported request content type. Please send 'application/json' or 'multipart/form-data'."}), 400

    if gemini_model is None:
        print("DEBUG: Gemini model is not initialized.") # Console log
        return jsonify({"error": "AI service not initialized on the server."}), 503

    # Prepare content for Gemini based on whether a file part exists
    contents_to_gemini = []

    # Add the prompt first
    if prompt:
        contents_to_gemini.append(prompt)
        print(f"DEBUG: Appending prompt to Gemini input: '{prompt[:50]}...'") # Console log

    # Add the file part if it exists
    if file_part:
        contents_to_gemini.append(file_part)
        print(f"DEBUG: Appending file part to Gemini input. MIME type: {file_part['mime_type']}") # Console log

    if not contents_to_gemini:
        print("DEBUG: No prompt or file content to send to Gemini.") # Console log
        return jsonify({"error": "No prompt or file content provided."}), 400

    # Retrieve chunks only if it's a text-based prompt AND not an image/binary file for multimodal
    rag_context = ""
    if prompt and not file_part:
        print(f"DEBUG: Attempting RAG retrieval for text prompt: '{prompt[:50]}...'") # Console log
        chunks = retrieve_chunks(prompt, top_k=3)
        if chunks:
            # --- START MODIFICATION ---
            logging.info(f"Retrieved {len(chunks)} chunks for query.")
            for i, chunk_content in enumerate(chunks):
                logging.info(f"--- Retrieved Chunk {i+1} ---")
                logging.info(chunk_content)
                logging.info(f"---------------------------\n")
            # --- END MODIFICATION ---

            rag_context = "\n\n".join(chunks)
            logging.info("Using RAG context for prompt.")
            print(f"DEBUG: RAG context retrieved. First chunk: '{chunks[0][:50]}...'") # Console log
        else:
            logging.info("No relevant chunks found. Relying on Gemini's general knowledge.")
            print("DEBUG: No RAG chunks found.") # Console log

    # Construct the final prompt for Gemini
    final_gemini_input = []
    if rag_context:
        formatted_rag_prompt = f"Answer the following question only using the provided context. If the answer cannot be found in the context, state 'I don't have enough information to answer that based on the provided context.' Do not use external knowledge.\n\nContext:\n{rag_context}\n\nQuestion: {prompt}\n\nAnswer:"
        final_gemini_input.append(formatted_rag_prompt)
        print(f"DEBUG: Final Gemini input (with RAG): '{formatted_rag_prompt[:100]}...'") # Console log
    else:
        final_gemini_input.append(prompt) # If no RAG context, just use the direct prompt
        print(f"DEBUG: Final Gemini input (without RAG): '{prompt[:100]}...'") # Console log

    if file_part:
        final_gemini_input.append(file_part)
        print(f"DEBUG: Final Gemini input also includes file part.") # Console log

    try:
        logging.info(f"Sending content to Gemini: {final_gemini_input[0] if isinstance(final_gemini_input[0], str) else '...file data...'}") # Log only first part
        print(f"DEBUG: Sending content to Gemini (first 200 chars or type): {final_gemini_input[0][:200] if isinstance(final_gemini_input[0], str) else type(final_gemini_input[0])}") # Console log, be careful with large file data here

        response = gemini_model.generate_content(final_gemini_input)

        if hasattr(response, 'text') and response.text.strip():
            response_text = response.text.strip()
            logging.info(f"Gemini response: {response_text[:100]}...")
            print(f"DEBUG: Gemini response received: {response_text[:200]}...") # Console log
            return jsonify({"response": response_text})
        else:
            logging.warning("Gemini API returned an empty or non-text response.")
            print("DEBUG: Gemini API returned an empty or non-text response.") # Console log
            return jsonify({"error": "Gemini API returned an empty or non-text response. This might be due to safety filters or lack of relevant information."}), 500

    except genai.types.BlockedPromptException as e:
        logging.error(f"Gemini API blocked the prompt due to safety reasons: {e}")
        print(f"DEBUG: Gemini API blocked prompt: {e}") # Console log
        return jsonify({"error": f"VirLaw AI: Your prompt was blocked by AI safety features. Please rephrase."}), 400
    except genai.APIError as e:
        logging.error(f"Gemini API specific error: {e}", exc_info=True)
        print(f"DEBUG: Gemini API error: {e}") # Console log
        return jsonify({"error": f"VirLaw AI: An API error occurred. Please try again. Details: {str(e)}"}), 500
    except Exception as e:
        logging.error(f"Error calling Gemini API: {e}", exc_info=True)
        print(f"DEBUG: General error calling Gemini API: {e}") # Console log
        return jsonify({"error": f"Failed to get response from Gemini: {str(e)}"}), 500


# --- NEW API ROUTE: UPLOAD DOCUMENT ---
# This is the dedicated endpoint for adding new documents to the RAG knowledge base
def parse_pdf_to_text(filepath):
    text = ""
    try:
        with open(filepath, 'rb') as file:
            reader = pypdf.PdfReader(file) # Using pypdf for PDF parsing
            for page_num in range(len(reader.pages)):
                page = reader.pages[page_num]
                text += page.extract_text() or "" # extract_text might return None
        logging.info(f"Successfully extracted text from PDF: {filepath}")
        return text
    except Exception as e:
        logging.error(f"Error parsing PDF file {filepath}: {e}")
        return None

@app.route("/upload_document", methods=["POST"])
def upload_document():
    global documents, faiss_index, embedder # Access global RAG components

    if 'file' not in request.files:
        logging.warning("No 'file' part in upload request.")
        return jsonify({"error": "No file part in the request"}), 400

    file = request.files['file']
    if file.filename == '':
        logging.warning("No selected file in upload request.")
        return jsonify({"error": "No selected file"}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(USER_UPLOAD_DIR, filename)
    file_mime_type = mimetypes.guess_type(filename)[0] or file.mimetype

    try:
        file.save(filepath)
        logging.info(f"File '{filename}' saved to {USER_UPLOAD_DIR}")

        extracted_text = None
        if file_mime_type == 'application/pdf':
            extracted_text = parse_pdf_to_text(filepath)
        elif file_mime_type.startswith('text/'):
            with open(filepath, 'r', encoding='utf-8') as f:
                extracted_text = f.read()
        else:
            logging.warning(f"Unsupported file type for RAG processing: {file_mime_type}. Only PDFs and text files are supported.")
            os.remove(filepath) # Clean up unsupported file
            return jsonify({"error": f"Unsupported file type: {file_mime_type}. Only PDF and text files are supported for RAG."}), 400

        if not extracted_text:
            logging.warning(f"Could not extract text from '{filename}'.")
            os.remove(filepath)
            return jsonify({"error": f"Could not extract readable text from the provided file."}), 400

        # --- Chunking with LangChain's RecursiveCharacterTextSplitter ---
        logging.info(f"Chunking text from '{filename}' using LangChain splitter...")
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000, # Experiment with this value for legal documents
            chunk_overlap=200, # Overlap helps maintain context between chunks
            length_function=len,
            separators=["\n\n", "\n", " ", ""] # Common separators for robust splitting
        )
        new_chunks = text_splitter.split_text(extracted_text)
        logging.info(f"Generated {len(new_chunks)} chunks.")

        if not new_chunks:
            logging.warning(f"No chunks generated from '{filename}'.")
            os.remove(filepath)
            return jsonify({"message": f"File '{filename}' processed, but no valid text chunks were generated."}), 200

        # --- Embeddings with SentenceTransformer ---
        logging.info(f"Generating embeddings for {len(new_chunks)} chunks from '{filename}' using SentenceTransformer...")
        if embedder is None:
            logging.error("SentenceTransformer embedder not initialized during document upload.")
            os.remove(filepath)
            return jsonify({"error": "Embedding service not ready. Please check server logs."}), 503

        try:
            new_embeddings = embedder.encode(new_chunks, convert_to_numpy=True)
        except Exception as e:
            logging.error(f"Failed to generate embeddings for '{filename}': {e}")
            os.remove(filepath)
            return jsonify({"error": f"Failed to generate embeddings for the document: {e}"}), 500


        # --- Add to FAISS Index and Update Documents List ---
        if faiss_index is None: # Initialize FAISS index if it's completely empty
            logging.info(f"Initializing FAISS index with dimension {new_embeddings.shape[1]}.")
            faiss_index = faiss.IndexFlatL2(new_embeddings.shape[1])
            documents = [] # Clear global documents if initializing a new index

        elif faiss_index.d != new_embeddings.shape[1]:
            logging.error(f"Dimension mismatch: new embeddings ({new_embeddings.shape[1]}) vs FAISS index ({faiss_index.d}). This implies a model change or corruption. Please clear '{VECTORSTORE_DIR}' and restart to rebuild.")
            os.remove(filepath)
            return jsonify({"error": "Embedding dimension mismatch. Cannot add to existing index. Please clear 'vectorstore' directory and restart the server."}), 500

        faiss_index.add(new_embeddings)
        documents.extend(new_chunks) # Add new chunks to the global list

        # --- Persist Changes ---
        faiss.write_index(faiss_index, FAISS_INDEX_PATH)
        with open(DOCUMENTS_LIST_PATH, "w", encoding="utf-8") as f:
            json.dump(documents, f)
        logging.info(f"Document '{filename}' successfully processed, embeddings added to FAISS, and vector store updated.")

        os.remove(filepath) # Clean up temporary uploaded file
        return jsonify({"message": f"Document '{filename}' processed and added to RAG knowledge base successfully. Total chunks: {len(documents)}"}), 200

    except Exception as e:
        logging.error(f"General error during document upload or processing of '{filename}': {e}", exc_info=True)
        if os.path.exists(filepath):
            os.remove(filepath) # Ensure cleanup on error
        return jsonify({"error": f"Failed to process document: {str(e)}"}), 500

# --- MAIN EXECUTION BLOCK ---
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)