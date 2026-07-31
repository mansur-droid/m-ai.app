import { NextResponse } from 'next/server';
import { streamChatCompletion } from '@/lib/ai/gateway';
import { providerIds } from '@/lib/ai/providers';
import type { ChatMessage, ChatStreamEvent, ProviderId, TokenUsage } from '@/lib/ai/types';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RequestBody = {
  provider?: string;
  model?: string;
  messages?: ChatMessage[];
  maxOutputTokens?: number;
  conversationId?: string;
};

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function createTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'New conversation';
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}…` : normalized;
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

  const latestUserMessage = [...body.messages].reverse().find((message) => message.role === 'user');
  if (!latestUserMessage) {
    return NextResponse.json({ error: 'A user message is required.' }, { status: 400 });
  }

  const provider = body.provider as ProviderId;
  const requestedModel = body.model?.trim() || undefined;
  const maxOutputTokens = body.maxOutputTokens === undefined
    ? undefined
    : Math.max(1, Math.min(32768, Math.floor(body.maxOutputTokens)));

  let conversationId = body.conversationId?.trim();
  if (conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  } else {
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        title: createTitle(latestUserMessage.content),
        provider,
        model: requestedModel ?? null,
      })
      .select('id')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Could not create conversation.' }, { status: 500 });
    }
    conversationId = data.id as string;
  }

  const { error: userMessageError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: 'user',
    content: latestUserMessage.content,
    metadata: { provider, model: requestedModel ?? null },
  });
  if (userMessageError) {
    return NextResponse.json({ error: userMessageError.message }, { status: 500 });
  }

  let providerStream: AsyncGenerator<ChatStreamEvent>;
  try {
    providerStream = streamChatCompletion({
      provider,
      model: requestedModel,
      messages: body.messages,
      maxOutputTokens,
      signal: request.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI provider request failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const resolvedConversationId = conversationId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = '';
      let resolvedModel = requestedModel ?? '';
      let usage: TokenUsage | undefined;
      let completed = false;

      try {
        for await (const event of providerStream) {
          if (event.type === 'start') {
            resolvedModel = event.model;
            controller.enqueue(encodeEvent({ ...event, conversationId: resolvedConversationId }));
            continue;
          }
          if (event.type === 'delta') assistantText += event.text;
          if (event.type === 'usage') usage = { ...usage, ...event.usage };
          if (event.type === 'done') completed = true;
          controller.enqueue(encodeEvent(event));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI provider stream failed.';
        controller.enqueue(encodeEvent({ type: 'error', message }));
      } finally {
        if (assistantText) {
          await supabase.from('messages').insert({
            conversation_id: resolvedConversationId,
            user_id: user.id,
            role: 'assistant',
            content: assistantText,
            metadata: {
              provider,
              model: resolvedModel || null,
              usage: usage ?? null,
              completed,
            },
          });
        }

        await supabase
          .from('conversations')
          .update({ provider, model: resolvedModel || requestedModel || null })
          .eq('id', resolvedConversationId);
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
