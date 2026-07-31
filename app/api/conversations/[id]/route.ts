import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id,title,provider,model,created_at,updated_at')
    .eq('id', id)
    .single();

  if (conversationError) {
    const status = conversationError.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: conversationError.message }, { status });
  }

  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('id,role,content,metadata,created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (messagesError) return NextResponse.json({ error: messagesError.message }, { status: 500 });
  return NextResponse.json({ conversation, messages });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { title?: string };
  try {
    body = await request.json() as { title?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: 'A non-empty title is required.' }, { status: 400 });

  const { data, error } = await supabase
    .from('conversations')
    .update({ title: title.slice(0, 120) })
    .eq('id', id)
    .select('id,title,provider,model,created_at,updated_at')
    .single();

  if (error) {
    const status = error.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ conversation: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new Response(null, { status: 204 });
}
