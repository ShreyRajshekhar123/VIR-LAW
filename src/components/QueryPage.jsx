// src/components/QueryPage.jsx
import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
} from "firebase/firestore";
import axios from "axios";

const QueryPage = () => {
  const { queryId } = useParams();
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoadingResponse, setIsLoadingResponse] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [sessionLoadError, setSessionLoadError] = useState(null);
  const [sendMessageError, setSendMessageError] = useState(null);
  const messagesEndRef = useRef(null);

  // New state to temporarily hold a message and file that needs to be sent AFTER a new session is created
  const [pendingMessage, setPendingMessage] = useState(null);
  const [pendingFile, setPendingFile] = useState(null); // New state for pending file

  // States for file input
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const fileInputRef = useRef(null);

  const currentUserId = auth.currentUser?.uid;

  // Effect to manage session data based on URL's queryId
  useEffect(() => {
    console.log("QueryPage useEffect: queryId changed or component mounted.");
    // Reset state for a clean slate whenever queryId changes
    setMessages([]);
    setInput("");
    setIsLoadingResponse(false);
    setIsSessionLoading(true);
    setSessionLoadError(null);
    setSendMessageError(null);
    // Reset file states
    setSelectedFile(null);
    setFilePreview(null);
    setPendingMessage(null); // Clear pending message
    setPendingFile(null); // Clear pending file

    if (!currentUserId) {
      console.log("QueryPage useEffect: User not authenticated.");
      setSessionLoadError("User not authenticated.");
      setIsSessionLoading(false);
      return;
    }

    if (queryId === "new") {
      console.log(
        "QueryPage useEffect: queryId is 'new'. Initializing new chat state."
      );
      setSessionTitle("New Chat");
      setMessages([]);
      setIsSessionLoading(false);
      return;
    }

    if (queryId) {
      console.log(
        `QueryPage useEffect: Loading existing session with ID: ${queryId}`
      );
      const sessionDocRef = doc(
        db,
        "users",
        currentUserId,
        "querySessions",
        queryId
      );

      const unsubscribeSession = onSnapshot(
        sessionDocRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const sessionData = docSnap.data();
            console.log(
              "QueryPage useEffect: Session document data:",
              sessionData
            );
            setSessionTitle(
              sessionData.title || `Session ${queryId.substring(0, 8)}`
            );
            setSessionLoadError(null);
          } else {
            console.warn(
              `Firestore document for session ID "${queryId}" not found for user "${currentUserId}". Redirecting to new.`
            );
            setSessionLoadError("Session not found.");
            setSessionTitle("Session Not Found");
            setMessages([]);
            navigate("/dashboard/new");
          }
          setIsSessionLoading(false);
        },
        (error) => {
          console.error(
            "QueryPage useEffect: Error fetching session document:",
            error
          );
          setSessionLoadError("Failed to load session details.");
          setIsSessionLoading(false);
        }
      );

      const messagesCollectionRef = collection(sessionDocRef, "messages");
      const q = query(messagesCollectionRef, orderBy("createdAt"));

      const unsubscribeMessages = onSnapshot(
        q,
        (snapshot) => {
          const loadedMessages = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));
          console.log(
            "QueryPage useEffect: Messages loaded from Firestore:",
            loadedMessages
          );
          setMessages(loadedMessages);
        },
        (error) => {
          console.error(
            "QueryPage useEffect: Error fetching messages for session:",
            error
          );
        }
      );

      return () => {
        console.log(
          `QueryPage useEffect: Cleaning up Firestore listeners for session ${queryId}.`
        );
        unsubscribeSession();
        unsubscribeMessages();
      };
    }

    console.log(
      "QueryPage useEffect: Defaulting to new chat state (no queryId provided)."
    );
    setSessionTitle("New Chat");
    setMessages([]);
    setIsSessionLoading(false);
  }, [queryId, currentUserId, db, navigate]);

  // Effect for auto-scrolling to the latest message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
      console.log("QueryPage useEffect: Scrolled to bottom.");
    }
  }, [messages]);

  // NEW useEffect to handle sending the pending message and file once queryId is stable
  useEffect(() => {
    console.log("QueryPage pendingMessage/File useEffect triggered.");
    console.log("  pendingMessage:", pendingMessage);
    console.log("  pendingFile:", pendingFile);
    console.log("  queryId:", queryId);
    console.log("  isSessionLoading:", isSessionLoading);
    console.log("  currentUserId:", currentUserId);

    if (
      pendingMessage !== null && // Use !== null because an empty string prompt is valid with a file
      queryId !== "new" &&
      queryId !== undefined &&
      !isSessionLoading &&
      currentUserId
    ) {
      console.log(
        "QueryPage pendingMessage/File useEffect: Conditions met. Processing pending message/file."
      );
      const processPendingMessage = async () => {
        setIsLoadingResponse(true);

        try {
          const sessionDocRef = doc(
            db,
            "users",
            currentUserId,
            "querySessions",
            queryId
          );
          console.log(
            "QueryPage pendingMessage/File useEffect: Session Doc Ref:",
            sessionDocRef.path
          );

          const docSnap = await getDoc(sessionDocRef);
          if (docSnap.exists()) {
            console.log(
              "QueryPage pendingMessage/File useEffect: Session document exists."
            );
            const currentTitle = docSnap.data().title;
            if (currentTitle === "New Chat") {
              const updatedTitle =
                (pendingMessage || "").substring(0, 50) +
                ((pendingMessage || "").length > 50 ? "..." : "");
              console.log(
                "QueryPage pendingMessage/File useEffect: Updating session title to:",
                updatedTitle
              );
              await updateDoc(sessionDocRef, {
                title: updatedTitle,
                lastUpdated: serverTimestamp(),
              });
              setSessionTitle(updatedTitle);
            } else {
              console.log(
                "QueryPage pendingMessage/File useEffect: Updating session lastUpdated timestamp."
              );
              await updateDoc(sessionDocRef, {
                lastUpdated: serverTimestamp(),
              });
            }
          }

          // Add the user's message to the messages subcollection in Firestore
          const userMessageDocRef = await addDoc(
            collection(
              db,
              "users",
              currentUserId,
              "querySessions",
              queryId,
              "messages"
            ),
            {
              text: pendingMessage,
              sender: "user",
              createdAt: serverTimestamp(),
              fileName: pendingFile ? pendingFile.name : null, // Store file metadata
              fileType: pendingFile ? pendingFile.type : null,
              fileSize: pendingFile ? pendingFile.size : null,
              fileDownloadURL: null, // No Firebase Storage URL if bypassing it
            }
          );
          console.log(
            "QueryPage pendingMessage/File useEffect: User message added to Firestore with ID:",
            userMessageDocRef.id
          );

          let aiResponseText =
            "An error occurred while getting a response from VirLaw AI.";
          try {
            let requestBody;
            let headers = {};

            if (pendingFile) {
              const formData = new FormData();
              formData.append("prompt", pendingMessage);
              formData.append("file", pendingFile);
              requestBody = formData;
              console.log(
                "QueryPage pendingMessage/File useEffect: Sending FormData to Python backend with file:",
                pendingFile.name
              );
            } else {
              requestBody = { prompt: pendingMessage };
              headers["Content-Type"] = "application/json";
              console.log(
                "QueryPage pendingMessage/File useEffect: Sending JSON to Python backend with prompt:",
                pendingMessage
              );
            }

            const ragResponse = await axios.post(
              "http://localhost:8000/gemini-rag",
              requestBody,
              { headers: headers }
            );
            aiResponseText = ragResponse.data.response;
            console.log(
              "QueryPage pendingMessage/File useEffect: AI response received:",
              aiResponseText
            );
          } catch (ragError) {
            console.error(
              "QueryPage pendingMessage/File useEffect: Error calling Python RAG API (for new session):",
              ragError
            );
            if (ragError.response) {
              aiResponseText = `VirLaw AI: Failed to get a response (Code: ${ragError.response.status}). Please check the Python backend.`;
              if (ragError.response.data && ragError.response.data.error) {
                aiResponseText = `VirLaw AI: ${ragError.response.data.error}`;
              }
            } else if (ragError.request) {
              aiResponseText =
                "VirLaw AI: No response from the AI server. Is the Python backend running?";
            } else {
              aiResponseText = `VirLaw AI: Error sending request: ${ragError.message}`;
            }
            setSendMessageError(aiResponseText);
          }

          const botMessageDocRef = await addDoc(
            collection(
              db,
              "users",
              currentUserId,
              "querySessions",
              queryId,
              "messages"
            ),
            {
              text: aiResponseText,
              sender: "bot",
              createdAt: serverTimestamp(),
            }
          );
          console.log(
            "QueryPage pendingMessage/File useEffect: AI message added to Firestore with ID:",
            botMessageDocRef.id
          );
        } catch (error) {
          console.error(
            "QueryPage pendingMessage/File useEffect: Error processing pending message in useEffect:",
            error
          );
          setSendMessageError(
            "Failed to send message or save session after creation. Please try again."
          );
        } finally {
          setIsLoadingResponse(false);
          setPendingMessage(null); // Clear the pending message after processing
          setPendingFile(null); // Clear pending file
          console.log(
            "QueryPage pendingMessage/File useEffect: Cleared pending message/file states."
          );
        }
      };

      processPendingMessage();
    }
  }, [
    pendingMessage,
    pendingFile,
    queryId,
    isSessionLoading,
    currentUserId,
    db,
    navigate,
  ]);

  // File handling functions
  const handleAddFileClick = () => {
    console.log("QueryPage: Add File button clicked. Opening file input.");
    fileInputRef.current.click();
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    console.log("QueryPage: File input change detected. Selected file:", file);
    if (file) {
      setSelectedFile(file);

      if (file.type.startsWith("text/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const textContent = e.target.result;
          const previewText =
            textContent.substring(0, 500) +
            (textContent.length > 500 ? "..." : "");
          setFilePreview(previewText);
          console.log("QueryPage: Text file preview generated.");
        };
        reader.readAsText(file);
      } else if (file.type.startsWith("image/")) {
        const objectURL = URL.createObjectURL(file);
        setFilePreview(objectURL);
        console.log(
          "QueryPage: Image file preview generated. Object URL:",
          objectURL
        );
      } else {
        setFilePreview(`File selected: ${file.name}. Preview not available.`);
        console.log(
          "QueryPage: Non-text/image file selected. No specific preview."
        );
      }
    } else {
      setSelectedFile(null);
      setFilePreview(null);
      console.log("QueryPage: No file selected, clearing file states.");
    }
  };

  const handleClearFile = () => {
    console.log("QueryPage: Clear File button clicked.");
    if (selectedFile && filePreview && selectedFile.type.startsWith("image/")) {
      URL.revokeObjectURL(filePreview);
      console.log("QueryPage: Revoked image object URL.");
    }
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      console.log("QueryPage: File input value cleared.");
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    console.log("QueryPage: Send message button clicked.");

    if ((!input.trim() && !selectedFile) || !currentUserId) {
      if (!currentUserId) {
        setSendMessageError("You must be logged in to send messages.");
        console.log("QueryPage: Send failed - User not authenticated.");
      } else if (!input.trim() && !selectedFile) {
        setSendMessageError("Please enter a message or select a file.");
        console.log("QueryPage: Send failed - No message and no file.");
      }
      return;
    }

    const promptToSend = input.trim();
    let userMessageForDisplay = promptToSend;

    if (!promptToSend && selectedFile) {
      userMessageForDisplay = `File uploaded: ${selectedFile.name}`;
      console.log("QueryPage: User message display set to file upload text.");
    }

    setInput("");
    handleClearFile();
    setSendMessageError(null);

    // Optimistic UI update: Add a temporary message for immediate display
    const tempUserMessage = {
      id: "temp-" + Date.now(),
      text: userMessageForDisplay,
      sender: "user",
      createdAt: new Date(),
      fileName: selectedFile ? selectedFile.name : null,
      fileType: selectedFile ? selectedFile.type : null,
      fileSize: selectedFile ? selectedFile.size : null,
      fileDownloadURL:
        selectedFile && selectedFile.type.startsWith("image/")
          ? URL.createObjectURL(selectedFile)
          : null,
    };
    setMessages((prevMessages) => [...prevMessages, tempUserMessage]);
    console.log(
      "QueryPage: Optimistic UI update - added temporary user message:",
      tempUserMessage
    );

    // Logic for new session creation or sending to existing session
    if (!queryId || queryId === "new") {
      console.log(
        "QueryPage: It's a new session. Creating new Firestore document."
      );
      try {
        const newSessionRef = await addDoc(
          collection(db, "users", currentUserId, "querySessions"),
          {
            title: "New Chat",
            createdAt: serverTimestamp(),
            lastUpdated: serverTimestamp(),
          }
        );
        const newSessionId = newSessionRef.id;
        console.log("QueryPage: New session created with ID:", newSessionId);

        setPendingMessage(promptToSend);
        setPendingFile(selectedFile);
        console.log(
          "QueryPage: Set pending message and file. Navigating to new session URL."
        );
        navigate(`/dashboard/${newSessionId}`, { replace: true });
      } catch (error) {
        console.error("QueryPage: Failed to create new session:", error);
        setSendMessageError("Failed to create new session. Please try again.");
        setIsLoadingResponse(false);
        setMessages((prevMessages) =>
          prevMessages.filter((msg) => msg.id !== tempUserMessage.id)
        );
      }
      return;
    }

    // For existing sessions
    let currentSessionFirestoreId = queryId;
    console.log(
      `QueryPage: Sending message to existing session ID: ${currentSessionFirestoreId}`
    );

    try {
      const sessionDocRef = doc(
        db,
        "users",
        currentUserId,
        "querySessions",
        currentSessionFirestoreId
      );

      const docSnap = await getDoc(sessionDocRef);
      if (docSnap.exists()) {
        const currentTitle = docSnap.data().title;
        console.log(
          "QueryPage: Existing session document data:",
          docSnap.data()
        );
        if (currentTitle === "New Chat") {
          const updatedTitle =
            (promptToSend || "").substring(0, 50) +
            ((promptToSend || "").length > 50 ? "..." : "");
          console.log(
            "QueryPage: Updating session title for existing 'New Chat' session to:",
            updatedTitle
          );
          await updateDoc(sessionDocRef, {
            title: updatedTitle,
            lastUpdated: serverTimestamp(),
          });
          setSessionTitle(updatedTitle);
        } else {
          console.log(
            "QueryPage: Updating lastUpdated timestamp for existing session."
          );
          await updateDoc(sessionDocRef, { lastUpdated: serverTimestamp() });
        }
      }

      // Add the user's message to Firestore (with file metadata)
      const userMsgFirestoreRef = await addDoc(
        collection(
          db,
          "users",
          currentUserId,
          "querySessions",
          currentSessionFirestoreId,
          "messages"
        ),
        {
          text: userMessageForDisplay,
          sender: "user",
          createdAt: serverTimestamp(),
          fileName: selectedFile ? selectedFile.name : null,
          fileType: selectedFile ? selectedFile.type : null,
          fileSize: selectedFile ? selectedFile.size : null,
          fileDownloadURL: null,
        }
      );
      console.log(
        "QueryPage: User message added to Firestore (existing session) with ID:",
        userMsgFirestoreRef.id
      );

      setIsLoadingResponse(true);

      let aiResponseText =
        "An error occurred while getting a response from VirLaw AI.";
      try {
        let requestBody;
        let headers = {};

        if (selectedFile) {
          const formData = new FormData();
          formData.append("prompt", promptToSend);
          formData.append("file", selectedFile);
          requestBody = formData;
          console.log(
            "QueryPage: Sending FormData to Python backend (existing session) with file:",
            selectedFile.name
          );
        } else {
          requestBody = { prompt: promptToSend };
          headers["Content-Type"] = "application/json";
          console.log(
            "QueryPage: Sending JSON to Python backend (existing session) with prompt:",
            promptToSend
          );
        }

        const ragResponse = await axios.post(
          "http://localhost:8000/gemini-rag",
          requestBody,
          { headers: headers }
        );

        aiResponseText = ragResponse.data.response;
        console.log(
          "QueryPage: AI response received (existing session):",
          aiResponseText
        );
      } catch (ragError) {
        console.error(
          "QueryPage: Error calling Python RAG API (for existing session):",
          ragError
        );
        if (ragError.response) {
          aiResponseText = `VirLaw AI: Failed to get a response (Code: ${ragError.response.status}). Please check the Python backend.`;
          if (ragError.response.data && ragError.response.data.error) {
            aiResponseText = `VirLaw AI: ${ragError.response.data.error}`;
          }
        } else if (ragError.request) {
          aiResponseText =
            "VirLaw AI: No response from the AI server. Is the Python backend running?";
        } else {
          aiResponseText = `VirLaw AI: Error sending request: ${ragError.message}`;
        }
        setSendMessageError(aiResponseText);
      } finally {
        setIsLoadingResponse(false);
      }

      const botMsgFirestoreRef = await addDoc(
        collection(
          db,
          "users",
          currentUserId,
          "querySessions",
          currentSessionFirestoreId,
          "messages"
        ),
        {
          text: aiResponseText,
          sender: "bot",
          createdAt: serverTimestamp(),
        }
      );
      console.log(
        "QueryPage: AI message added to Firestore (existing session) with ID:",
        botMsgFirestoreRef.id
      );
    } catch (error) {
      console.error(
        "QueryPage: Error in handleSendMessage (Firebase or initial setup) for existing session:",
        error
      );
      setIsLoadingResponse(false);
      setSendMessageError(
        "Failed to send message or save session. Please try again."
      );
      setMessages((prevMessages) =>
        prevMessages.filter((msg) => msg.id !== tempUserMessage.id)
      );
    }
  };

  // Helper functions for file display
  const formatFileSize = (bytes) => {
    if (bytes === null || bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    else if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    else return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileExtension = (filename) => {
    return filename ? filename.split(".").pop().toUpperCase() : "UNKNOWN";
  };

  const handleDownloadFile = (fileName, fileType, fileDownloadURL) => {
    console.log(`QueryPage: Attempting to 'download' file: ${fileName}.`);
    alert(
      `File "${fileName}" was sent directly to the backend. It is not available for direct download from the frontend in this setup.`
    );
  };

  if (isSessionLoading) {
    return <div className="p-4 text-gray-100">Loading session...</div>;
  }

  if (sessionLoadError) {
    return (
      <div className="p-4 text-red-400">
        Error: {sessionLoadError}
        <button
          onClick={() => navigate("/dashboard/new")}
          className="ml-4 bg-blue-600 hover:bg-blue-700 text-white py-1 px-3 rounded"
        >
          Start New Query
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-800 text-gray-100">
      {/* Session Title Bar */}
      <div className="p-4 bg-gray-900 shadow-md flex items-center justify-between">
        <h2 className="text-2xl font-bold text-blue-300">{sessionTitle}</h2>
      </div>

      {/* Messages Display Area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col custom-scrollbar">
        {/* On-screen error message for sending */}
        {sendMessageError && (
          <div className="p-2 mb-4 bg-red-800 text-red-200 rounded-md text-center">
            {sendMessageError}
          </div>
        )}

        {messages.length === 0 &&
        !isLoadingResponse &&
        (queryId === "new" || !queryId) ? (
          <div className="text-center text-gray-400 mt-20">
            Start a new conversation...
          </div>
        ) : messages.length === 0 && !isLoadingResponse && queryId !== "new" ? (
          <div className="text-center text-gray-400 mt-20">
            No messages in this session yet. Type a message below!
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`mb-4 p-3 rounded-lg max-w-[80%] ${
                msg.sender === "user"
                  ? "bg-blue-600 self-end ml-auto"
                  : "bg-gray-700 self-start mr-auto"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              {msg.fileName && msg.sender === "user" && (
                <div className="mt-1 text-xs bg-blue-700 p-2 rounded-md flex items-center justify-between">
                  <span className="text-gray-300">
                    [Attached:{" "}
                    <button
                      onClick={() =>
                        handleDownloadFile(
                          msg.fileName,
                          msg.fileType,
                          msg.fileDownloadURL
                        )
                      }
                      className="text-blue-200 hover:underline focus:outline-none"
                      title="Click for details (no direct download)"
                    >
                      {msg.fileName}
                    </button>
                    {msg.fileSize !== null &&
                      msg.fileSize !== undefined &&
                      ` (${formatFileSize(msg.fileSize)})`}
                    {msg.fileType && ` [${getFileExtension(msg.fileName)}]`}]
                  </span>
                  {/* Display image preview directly if available and it's an image */}
                  {msg.fileDownloadURL &&
                    msg.fileType?.startsWith("image/") && (
                      <img
                        src={msg.fileDownloadURL}
                        alt="Attached file preview"
                        className="max-h-24 max-w-full object-contain mt-1 rounded"
                      />
                    )}
                </div>
              )}
            </div>
          ))
        )}
        {isLoadingResponse && (
          <div className="mb-4 p-3 rounded-lg bg-gray-700 self-start mr-auto max-w-[80%]">
            <p className="text-sm">VirLaw AI is typing...</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* File Preview Area */}
      {selectedFile && (
        <div className="p-3 bg-gray-700 border-t border-gray-600 flex flex-col items-start space-y-2 text-sm">
          <p className="text-gray-300">
            Selected File:{" "}
            <strong className="text-white">{selectedFile.name}</strong> (
            {formatFileSize(selectedFile.size)}) [
            {getFileExtension(selectedFile.name)}]
          </p>
          {selectedFile.type.startsWith("text/") && filePreview && (
            <pre className="w-full max-h-24 overflow-y-auto bg-gray-800 p-2 rounded text-gray-200 text-xs whitespace-pre-wrap break-all border border-gray-600">
              {filePreview}
            </pre>
          )}
          {selectedFile.type.startsWith("image/") && filePreview && (
            <img
              src={filePreview}
              alt="File Preview"
              className="max-w-full max-h-32 object-contain rounded border border-gray-600"
            />
          )}

          {!selectedFile.type.startsWith("text/") &&
            !selectedFile.type.startsWith("image/") &&
            filePreview && <p className="text-gray-400">{filePreview}</p>}

          <button
            onClick={handleClearFile}
            className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 text-xs"
          >
            Clear File
          </button>
        </div>
      )}

      {/* Input Area */}
      <form
        onSubmit={handleSendMessage}
        className="p-4 bg-gray-900 border-t border-gray-700 flex items-center flex-shrink-0"
      >
        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: "none" }}
          accept=".txt,.pdf,.png,.jpg,.jpeg,.gif,.docx,.doc"
        />

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 p-3 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoadingResponse || !currentUserId}
        />

        <button
          type="button"
          onClick={handleAddFileClick}
          className="ml-2 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isLoadingResponse || !currentUserId}
        >
          Add File
        </button>

        <button
          type="submit"
          className="ml-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={
            isLoadingResponse ||
            (!input.trim() && !selectedFile) ||
            !currentUserId
          }
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default QueryPage;
