import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Plus, BarChart2, Trash2 } from 'lucide-react';
import type { Conversation } from '../api';

interface SidebarProps {
  conversations: Conversation[];
  activeSessionId: string | null;
  activeTab: 'chat' | 'dashboard';
  setActiveTab: (tab: 'chat' | 'dashboard') => void;
  onSelectConversation: (sessionId: string) => void;
  onNewChat: () => void;
  onCancelConversation: (sessionId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeSessionId,
  activeTab,
  setActiveTab,
  onSelectConversation,
  onNewChat,
  onCancelConversation,
}) => {
  
  const handleCancelClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to cancel and archive this conversation?')) {
      onCancelConversation(sessionId);
    }
  };

  return (
    <div className="sidebar">
      {/* Header section with New Chat */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <MessageSquare size={20} className="text-primary" />
          <span>Ollive</span>Telemetry
        </div>
        <button className="new-chat-btn" onClick={onNewChat}>
          <Plus size={16} />
          New Chat
        </button>
      </div>

      {/* Scrollable list of chat sessions */}
      <div className="conversations-list">
        {conversations.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No conversation sessions
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.sessionId === activeSessionId && activeTab === 'chat';
            
            // Try formatting date safely
            let formattedTime = 'Just now';
            try {
              if (conv.lastMessageAt) {
                formattedTime = formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true });
              }
            } catch (err) {
              // ignore
            }

            return (
              <div
                key={conv.id}
                className={`conv-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('chat');
                  onSelectConversation(conv.sessionId);
                }}
              >
                <div className="conv-title-row">
                  <div className="conv-title" title={`Session: ${conv.sessionId}`}>
                    {/* Fallback description */}
                    {conv.model} Session
                  </div>
                  {conv.status === 'cancelled' ? (
                    <span className="badge-status cancelled">Archived</span>
                  ) : (
                    <span className="badge-status active">Active</span>
                  )}
                </div>

                <div className="conv-details">
                  <div className="conv-meta">
                    <span className={`badge badge-${conv.provider}`}>
                      {conv.provider}
                    </span>
                    <span>{conv.messageCount} msg</span>
                  </div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    {formattedTime}
                  </span>
                </div>

                {conv.status !== 'cancelled' && (
                  <button
                    className="delete-conv-btn"
                    title="Cancel/Archive Conversation"
                    onClick={(e) => handleCancelClick(e, conv.sessionId)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer with Navigation */}
      <div className="sidebar-footer">
        <button
          className={`nav-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquare size={16} />
          Chat Client
        </button>
        <button
          className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <BarChart2 size={16} />
          Observability
        </button>
      </div>
    </div>
  );
};
