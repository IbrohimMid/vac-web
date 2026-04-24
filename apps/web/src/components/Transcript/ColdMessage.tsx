import { memo } from 'react';
import { useTranscript } from '../../stores/transcript';

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
    return (
      <div
        className={`message message-cold message-${msg.role}`}
        data-msg-id={id}
        style={{
          padding: 8,
          borderBottom: '1px solid #eee',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
  () => true, // never re-render once mounted
);
