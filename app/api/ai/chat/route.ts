import { NextResponse } from 'next/server';
import { streamChatCompletion } from '@/lib/ai/gateway';
import { providerIds } from '@/lib/ai/providers';
import type { ChatMessage, ChatStreamEvent, ProviderId } from '@/lib/ai/types';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody = {
  provider?: string;
  model?: string;
  messages?: ChatMessage[];
  maxOutputTokens?: number;
};

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.provider || !providerIds.includes(body.provider as ProviderId)) {
    return NextResponse.json({ error: 'A supported provider is required.' }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'At least one message is required.' }, { status: 400 });
  }

  const validMessages = body.messages.every((message) =>
    ['system', 'user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' &&
    message.content.trim().length > 0,
  );
  if (!validMessages) {
    return NextResponse.json({ error: 'Messages contain invalid roles or empty content.' }, { status: 400 });
  }

  const maxOutputTokens = body.maxOutputTokens === undefined
    ? undefined
    : Math.max(1, Math.min(32768, Math.floor(body.maxOutputTokens)));

  let providerStream: AsyncGenerator<ChatStreamEvent>;
  try {
    providerStream = streamChatCompletion({
      provider: body.provider as ProviderId,
      model: body.model?.trim() || undefined,
      messages: body.messages,
      maxOutputTokens,
      signal: request.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI provider request failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of providerStream) {
          controller.enqueue(encodeEvent(event));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI provider stream failed.';
        controller.enqueue(encodeEvent({ type: 'error', message }));
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await providerStream.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
