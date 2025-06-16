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
  getDoc, // Import getDoc to fetch a single document
} from "firebase/firestore";

const QueryPage = () => {
  const { queryId } = useParams();
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoadingResponse, setIsLoadingResponse] = useState(false); // Controls AI thinking state
  const [sessionTitle, setSessionTitle] = useState("New Chat"); // Default title, should match Sidebar's initial title
  const [isSessionLoading, setIsSessionLoading] = useState(true); // For initial session data load
  const [sessionLoadError, setSessionLoadError] = useState(null); // For session loading errors
  const [sendMessageError, setSendMessageError] = useState(null); // New state for send message errors
  const messagesEndRef = useRef(null);

  const currentUserId = auth.currentUser?.uid; // Get UID safely

  // Effect to manage session data based on URL's queryId
  useEffect(() => {
    // Reset state for a clean slate whenever queryId changes
    setMessages([]);
    setInput("");
    setIsLoadingResponse(false); // Reset AI loading state
    setIsSessionLoading(true);
    setSessionLoadError(null);
    setSendMessageError(null); // Also reset send message error on queryId change

    // If no user is logged in, or if queryId is missing/invalid, do nothing or redirect
    if (!currentUserId) {
      setSessionLoadError("User not authenticated.");
      setIsSessionLoading(false);
      return;
    }

    // Case 1: Starting a new query (URL is /dashboard/new) - temporary state
    if (queryId === "new") {
      setSessionTitle("New Chat"); // Initial title for this temporary state
      setMessages([]); // Ensure messages are empty for a fresh start
      setIsSessionLoading(false); // No data to load for a new session
      return; // Exit as no Firestore listener is needed yet for a /new route
    }

    // Case 2: Loading an existing query (URL is /dashboard/:queryId)
    if (queryId) {
      const sessionDocRef = doc(
        db,
        "users",
        currentUserId,
        "querySessions",
        queryId
      );

      // Listener for the session document itself (for title, existence)
      const unsubscribeSession = onSnapshot(
        sessionDocRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setSessionTitle(
              docSnap.data().title || `Session ${queryId.substring(0, 8)}`
            );
            setSessionLoadError(null);
          } else {
            // If the document doesn't exist, handle it (e.g., redirect to new query)
            console.warn(
              `Firestore document for session ID "${queryId}" not found for user "${currentUserId}".`
            );
            setSessionLoadError("Session not found.");
            setSessionTitle("Session Not Found");
            setMessages([]); // Clear any old messages
            // Optionally, navigate to a new query if an invalid ID is in the URL
            navigate("/dashboard/new"); // Redirect to a new temporary session
          }
          setIsSessionLoading(false); // Session info loaded (or determined not to exist)
        },
        (error) => {
          console.error("Error fetching session document:", error);
          setSessionLoadError("Failed to load session details.");
          setIsSessionLoading(false);
        }
      );

      // Listener for messages within this session
      const messagesCollectionRef = collection(sessionDocRef, "messages");
      const q = query(messagesCollectionRef, orderBy("createdAt"));

      const unsubscribeMessages = onSnapshot(
        q,
        (snapshot) => {
          const loadedMessages = snapshot.docs.map((doc) => ({
            id: doc.id, // Firestore message ID
            ...doc.data(), // message text, sender, createdAt
          }));
          setMessages(loadedMessages);
        },
        (error) => {
          console.error("Error fetching messages for session:", error);
          // Do not set global error, as session info might still be valid
        }
      );

      // Cleanup listeners when component unmounts or queryId/user changes
      return () => {
        unsubscribeSession();
        unsubscribeMessages();
      };
    }

    // Default case if no queryId is provided (e.g., direct /dashboard access without /new or an ID)
    // We treat this as a new query
    setSessionTitle("New Chat"); // Ensure initial title matches Sidebar's.
    setMessages([]);
    setIsSessionLoading(false);
  }, [queryId, currentUserId, db, navigate]); // Depend on queryId, userId, db, and navigate

  // Effect for auto-scrolling to the latest message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]); // Scroll when messages change

  // Handler for sending a message (user or AI)
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || !currentUserId) return; // Prevent sending empty messages or if no user

    const userMessageText = input; // Store input value
    setInput(""); // Clear input field immediately after capturing value
    setSendMessageError(null); // Clear previous send message errors

    // OPTIMISTIC UI UPDATE: Add user message to local state immediately for instant display
    const tempUserMessage = {
      id: "temp-" + Date.now(), // Unique temporary ID for immediate rendering
      text: userMessageText,
      sender: "user",
      createdAt: new Date(), // Client-side timestamp for quick display
    };
    setMessages((prevMessages) => [...prevMessages, tempUserMessage]);

    let currentSessionFirestoreId = queryId; // This will hold the actual Firestore session ID

    try {
      // If it's a new query (URL is /dashboard/new), create the session document first
      if (queryId === "new") {
        const newSessionRef = await addDoc(
          collection(db, "users", currentUserId, "querySessions"),
          {
            title: "New Chat", // Initial title, will be updated below
            createdAt: serverTimestamp(),
            lastUpdated: serverTimestamp(),
          }
        );
        currentSessionFirestoreId = newSessionRef.id;
        // Update URL to the real session ID for persistence and navigation
        navigate(`/dashboard/${currentSessionFirestoreId}`);
        console.log(
          "New session created from QueryPage with ID:",
          currentSessionFirestoreId
        );
      }

      // Now, for ANY session (newly created or existing), update its title if it's still generic
      const sessionDocRef = doc(
        db,
        "users",
        currentUserId,
        "querySessions",
        currentSessionFirestoreId
      );

      // Fetch the current session document to check its title
      const docSnap = await getDoc(sessionDocRef); // Use getDoc to fetch once

      // If the session exists and its title is still the generic "New Chat"
      if (docSnap.exists() && docSnap.data().title === "New Chat") {
        const updatedTitle =
          userMessageText.substring(0, 50) +
          (userMessageText.length > 50 ? "..." : "");
        await updateDoc(sessionDocRef, {
          title: updatedTitle,
          lastUpdated: serverTimestamp(),
        });
        setSessionTitle(updatedTitle); // Update local state for immediate display
      } else {
        // If the title was already updated or it's an old session, just update lastUpdated
        await updateDoc(sessionDocRef, { lastUpdated: serverTimestamp() });
      }

      // Add the user's message to the messages subcollection in Firestore
      await addDoc(
        collection(
          db,
          "users",
          currentUserId,
          "querySessions",
          currentSessionFirestoreId,
          "messages"
        ),
        {
          text: userMessageText,
          sender: "user",
          createdAt: serverTimestamp(), // Use server timestamp for the actual database record
        }
      );

      // Now that the user's message is sent/displayed, indicate that AI is "thinking"
      setIsLoadingResponse(true);

      // Simulate AI response (THIS IS WHERE YOU'D REPLACE WITH ACTUAL LLM API CALL)
      setTimeout(async () => {
        const aiResponse = {
          text: `VirLaw AI: I received your query "${userMessageText}". Analyzing now...`, // Temporary AI response
          sender: "bot",
          createdAt: serverTimestamp(),
        };
        try {
          await addDoc(
            collection(
              db,
              "users",
              currentUserId,
              "querySessions",
              currentSessionFirestoreId,
              "messages"
            ),
            aiResponse
          );
        } catch (error) {
          console.error("Error adding AI message:", error);
          setSendMessageError("Failed to get AI response."); // Display an error if AI message fails
        } finally {
          setIsLoadingResponse(false); // AI response processed, allow further user input
        }
      }, 1000); // Simulate 1 second delay for AI response
    } catch (error) {
      console.error("Error in handleSendMessage:", error);
      setIsLoadingResponse(false); // Re-enable input on error
      setSendMessageError("Failed to send message. Please try again."); // Set an on-screen error
    }
  };

  // Render loading state, error state, or the chat UI
  if (isSessionLoading) {
    return <div className="p-4 text-gray-100">Loading session...</div>;
  }

  // Session load error takes precedence
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
              key={msg.id} // Use Firestore document ID or temporary ID as key for messages
              className={`mb-4 p-3 rounded-lg max-w-[80%] ${
                msg.sender === "user"
                  ? "bg-blue-600 self-end ml-auto" // User messages on right
                  : "bg-gray-700 self-start mr-auto" // AI messages on left
              }`}
            >
              <p className="text-sm">{msg.text}</p>
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

      {/* Input Area */}
      <form
        onSubmit={handleSendMessage}
        className="p-4 bg-gray-900 border-t border-gray-700 flex items-center flex-shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 p-3 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          // Input should only be disabled if AI is loading (isLoadingResponse is true) or no user
          disabled={isLoadingResponse || !currentUserId}
        />
        <button
          type="submit"
          className="ml-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          // Button should be disabled if AI is loading OR input is empty OR no user
          disabled={isLoadingResponse || !input.trim() || !currentUserId}
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default QueryPage;
