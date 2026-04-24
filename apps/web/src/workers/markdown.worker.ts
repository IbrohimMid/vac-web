// Off-main-thread markdown rendering for large messages.
// Message: { id: string, src: string } → { id, html }

/// <reference lib="webworker" />
import { renderMarkdown } from '../markdown/full';

interface Req {
  id: string;
  src: string;
}
interface Resp {
  id: string;
  html: string;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, src } = e.data;
  const html = renderMarkdown(src);
  (self as unknown as Worker).postMessage({ id, html } satisfies Resp);
};
