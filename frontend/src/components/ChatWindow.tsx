import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, StopCircle } from 'lucide-react';
import type { Message } from '../api';

interface ChatWindowProps {
  messages: Message[];
  isGenerating: boolean;
  onSendMessage: (content: string, provider: 'groq' | 'gemini', model: string) => void;
  onCancelGeneration: () => void;
  selectedProvider: 'groq' | 'gemini';
  setSelectedProvider: (provider: 'groq' | 'gemini') => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
}

const PROVIDER_MODELS = {
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Versatile)' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Instant)' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ],
  gemini: [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};

export const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  isGenerating,
  onSendMessage,
  onCancelGeneration,
  selectedProvider,
  setSelectedProvider,
  selectedModel,
  setSelectedModel,
}) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Set default model when provider changes if current model is incompatible
  useEffect(() => {
    const models = PROVIDER_MODELS[selectedProvider];
    const modelExists = models.some((m) => m.value === selectedModel);
    if (!modelExists) {
      setSelectedModel(models[0].value);
    }
  }, [selectedProvider, selectedModel, setSelectedModel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;
    
    onSendMessage(input.trim(), selectedProvider, selectedModel);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="main-content">
      {/* Header controls for provider and model selection */}
      <div className="chat-header">
        <div className="chat-header-title">
          <Sparkles size={18} style={{ color: 'var(--primary)' }} />
          <span className="chat-header-name">AI Playground</span>
        </div>

        <div className="chat-controls">
          {/* Provider Selection */}
          <div className="selector-group">
            <label htmlFor="provider-select">Provider:</label>
            <select
              id="provider-select"
              className="select-input"
              value={selectedProvider}
              onChange={(e) => {
                const prov = e.target.value as 'groq' | 'gemini';
                setSelectedProvider(prov);
                setSelectedModel(PROVIDER_MODELS[prov][0].value);
              }}
            >
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
            </select>
          </div>

          {/* Model Selection */}
          <div className="selector-group">
            <label htmlFor="model-select">Model:</label>
            <select
              id="model-select"
              className="select-input"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {PROVIDER_MODELS[selectedProvider].map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-logo">
              <Sparkles />
            </div>
            <h1 className="welcome-title">LLM Inference logging Sandbox</h1>
            <p className="welcome-subtitle">
              Start a multi-turn conversation with Groq or Gemini models. 
              All inference telemetry, latency, token usage, and PII alerts are monitored in real time.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message-bubble ${msg.role}`}>
              <div className="message-meta">
                <span>{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                <span>•</span>
                <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {msg.content}
                {msg.role === 'assistant' && isGenerating && msg.id === messages[messages.length - 1].id && (
                  <span className="streaming-cursor" />
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="chat-input-container">
        <form onSubmit={handleSubmit} className="chat-input-form">
          <textarea
            className="chat-input"
            placeholder={isGenerating ? "AI is generating a response..." : "Ask me anything... (Shift+Enter for newline)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
            rows={1}
            style={{ resize: 'none', height: '48px', paddingTop: '12px' }}
          />

          <div className="chat-input-actions">
            {isGenerating && (
              <button
                type="button"
                className="cancel-generation-btn"
                onClick={onCancelGeneration}
              >
                <StopCircle size={14} />
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="send-message-btn"
              disabled={!input.trim() || isGenerating}
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
