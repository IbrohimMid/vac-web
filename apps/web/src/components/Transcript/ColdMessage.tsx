import { memo } from 'react';
import { useTranscript } from '../../stores/transcript';
import { Icon, Avatar } from '../cockpit/primitives';

/**
 * Cold message — sanitized HTML injected via dangerouslySetInnerHTML.
 * React.memo with always-true comparator ensures this NEVER re-renders
 * once mounted. Source is frozen; any interactivity lives via event
 * delegation on the scroll container.
 */
export const ColdMessage = memo(
  function ColdMessage({ id }: { id: string }) {
    const msg = useTranscript.getState().messages.get(id);
    const html = msg?.renderedHTML;
    if (!html) return null;
    const timeString = msg?.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const authorName = msg?.role === 'user' ? 'You' : 'VAC - Planner';

    return (
      <div
        className={`message-wrapper role-${msg.role} cold`}
        data-msg-id={id}
      >
        <div className="message-avatar-col">
          {msg.role === 'user' ? (
            <Avatar name="You" />
          ) : (
            <div className="avatar-bot-bg">
              <Icon name="bot" size={16} />
            </div>
          )}
        </div>
        <div className="message-content-col">
          <header className="message-header">
            <strong className="message-author">{authorName}</strong>
            <span className="message-time">{timeString}</span>
          </header>
          <div 
            className="message-body markdown-body" 
            dangerouslySetInnerHTML={{ __html: html }} 
          />
        </div>
      </div>
    );
  },
  () => true, // never re-render once mounted
);
