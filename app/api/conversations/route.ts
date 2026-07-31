import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('conversations')
    .select('id,title,provider,model,created_at,updated_at')
    .eq('is_archived', false)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { title?: string; provider?: string; model?: string };
  try {
    body = await request.json() as { title?: string; provider?: string; model?: string };
  } catch {
    body = {};
  }

  const title = body.title?.trim().slice(0, 120) || 'New conversation';
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: user.id,
      title,
      provider: body.provider?.trim() || null,
      model: body.model?.trim() || null,
    })
    .select('id,title,provider,model,created_at,updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data }, { status: 201 });
}
