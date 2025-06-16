// src/MyPage.jsx
import React, { useState } from "react";
import MainContent from "./components/MainContent";
import InputBox from "./components/InputBox";

const MyPage = () => {
  // Messages and input text state, specific to the main page's functionality
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");

  // Handlers for sending messages and adding files
  const handleSendMessage = () => {
    if (inputText.trim()) {
      setMessages((prevMessages) => [
        ...prevMessages,
        { type: "text", content: inputText.trim() },
      ]);
      setInputText("");
    }
  };

  const handleAddFile = (file) => {
    if (file && file.name) {
      setMessages((prevMessages) => [
        ...prevMessages,
        { type: "file", content: file.name },
      ]);
    }
  };

  return (
    <>
      {" "}
      {/* React Fragment: MyPage is now a child of the 'main' tag in App.jsx */}
      <MainContent messages={messages} />
      <InputBox
        inputText={inputText}
        setInputText={setInputText}
        onSendMessage={handleSendMessage}
        onAddFile={handleAddFile}
      />
    </>
  );
};

export default MyPage;
