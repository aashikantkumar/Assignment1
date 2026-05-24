import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { Dashboard } from './components/Dashboard';
import { 
  getConversations, getMessages, cancelConversation, 
  streamChatResponse
} from './api';
import type { Conversation, Message } from './api';

function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'dashboard'>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Persist provider and model preferences in local storage
  const [selectedProvider, setSelectedProvider] = useState<'groq' | 'gemini'>(() => {
    return (localStorage.getItem('preferred_provider') as 'groq' | 'gemini') || 'groq';
  });
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('preferred_model') || 'llama-3.3-70b-versatile';
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  // Save provider and model selections in localStorage when they change
  useEffect(() => {
    localStorage.setItem('preferred_provider', selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    localStorage.setItem('preferred_model', selectedModel);
  }, [selectedModel]);

  // Load conversation list on mount
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      const list = await getConversations();
      setConversations(list);
    } catch (err) {
      console.error('[App] Failed to load conversations:', err);
    }
  };

  // Selects an existing conversation and loads messages
  const handleSelectConversation = async (sessionId: string) => {
    if (isGenerating) {
      handleCancelGeneration();
    }
    
    setMessages([]);
    setActiveSessionId(sessionId);
    
    try {
      const msgList = await getMessages(sessionId);
      setMessages(msgList);
    } catch (err) {
      console.error('[App] Failed to load messages:', err);
      alert('Failed to load conversation history.');
    }
  };

  // Cancels / Archives a conversation session
  const handleCancelConversation = async (sessionId: string) => {
    try {
      // Optimistic update
      setConversations((prev) =>
        prev.map((c) => (c.sessionId === sessionId ? { ...c, status: 'cancelled' } : c))
      );
      
      await cancelConversation(sessionId);
      
      // If we cancelled the active conversation, refresh details or stay active
      await loadConversations();
    } catch (err) {
      console.error('[App] Failed to cancel conversation:', err);
      alert('Failed to cancel conversation.');
      // Revert
      loadConversations();
    }
  };

  // Aborts an active SSE response stream
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    loadConversations();
  };

  // Starts a new chat session
  const handleNewChat = () => {
    if (isGenerating) {
      handleCancelGeneration();
    }
    setActiveSessionId(null);
    setMessages([]);
  };

  // Send a message and stream response
  const handleSendMessage = async (content: string, provider: 'groq' | 'gemini', model: string) => {
    if (isGenerating) return;

    // Use current session ID or generate a new one for first message
    const sessionId = activeSessionId || uuidv4();
    if (!activeSessionId) {
      setActiveSessionId(sessionId);
    }

    // 1. Append User Message to local state
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    // 2. Set up assistant placeholder message
    const assistantMsgId = uuidv4();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMsg]);
    setIsGenerating(true);

    // Create abort controller for request cancel support
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Build the request history (send up to 30 turns for better context)
    // We map UI Message to API Format
    let requestMessages = newMessages
      .slice(-30)
      .map((m) => ({ role: m.role, content: m.content }));

    // Ensure the conversation always starts with a 'user' message 
    // (Strict models like Gemini will fail or lose context if it starts with an assistant message)
    if (requestMessages.length > 0 && requestMessages[0].role === 'assistant') {
      requestMessages = requestMessages.slice(1);
    }

    try {
      const stream = streamChatResponse(
        sessionId,
        provider,
        model,
        requestMessages,
        controller.signal
      );

      let fullContent = '';

      for await (const chunk of stream) {
        if (chunk.error) {
          throw new Error(chunk.error);
        }

        if (chunk.delta) {
          fullContent += chunk.delta;
          // Update the assistant bubble content
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, content: fullContent } : msg
            )
          );
        }
      }

      setIsGenerating(false);
      abortControllerRef.current = null;
      // Reload sidebar conversation stats
      loadConversations();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[App] Chat generation was aborted by user.');
        // Add cancelled note
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId 
              ? { ...msg, content: msg.content + '\n\n*(Generation cancelled by user)*' } 
              : msg
          )
        );
      } else {
        console.error('[App] Streaming failed:', err);
        // Render error message
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, content: `Error: ${err.message || 'Connection lost. Failed to generate response.'}` }
              : msg
          )
        );
      }
      setIsGenerating(false);
      abortControllerRef.current = null;
      loadConversations();
    }
  };

  return (
    <div id="root">
      {/* Sidebar Session Manager */}
      <Sidebar
        conversations={conversations}
        activeSessionId={activeSessionId}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onCancelConversation={handleCancelConversation}
      />

      {/* Main View Panel */}
      {activeTab === 'chat' ? (
        <ChatWindow
          messages={messages}
          isGenerating={isGenerating}
          onSendMessage={handleSendMessage}
          onCancelGeneration={handleCancelGeneration}
          selectedProvider={selectedProvider}
          setSelectedProvider={setSelectedProvider}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
        />
      ) : (
        <Dashboard />
      )}
    </div>
  );
}

export default App;
