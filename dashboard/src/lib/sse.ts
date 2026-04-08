import { NextRequest } from 'next/server';

/**
 * Shared SSE response factory.
 *
 * Encapsulates the ReadableStream boilerplate, TextEncoder, named-event formatting,
 * and abort-signal cleanup that every SSE route repeats.
 *
 * Usage:
 *   return createSSEResponse(request, (emit, onCleanup) => {
 *     const interval = setInterval(() => emit('tick', { ts: Date.now() }), 1000);
 *     onCleanup(() => clearInterval(interval));
 *   });
 */
export function createSSEResponse(
  request: NextRequest,
  setup: (
    emit: (event: string, data: unknown) => void,
    onCleanup: (fn: () => void) => void,
  ) => void,
): Response {
  const encoder = new TextEncoder();
  const cleanupFns: Array<() => void> = [];

  const stream = new ReadableStream({
    start(controller) {
      function emit(eventName: string, data: unknown) {
        try {
          const json = JSON.stringify(data);
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${json}\n\n`),
          );
        } catch {
          // Stream may already be closed
        }
      }

      function onCleanup(fn: () => void) {
        cleanupFns.push(fn);
      }

      setup(emit, onCleanup);

      request.signal.addEventListener('abort', () => {
        for (const fn of cleanupFns) {
          try { fn(); } catch { /* ignore */ }
        }
        try { controller.close(); } catch { /* stream may already be closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
