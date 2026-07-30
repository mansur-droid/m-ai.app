import { NextResponse } from 'next/server';
import { listProviderModels } from '@/lib/ai/gateway';
import { providerIds } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/ai/types';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider } = await context.params;
  if (!providerIds.includes(provider as ProviderId)) {
    return NextResponse.json({ error: 'Unsupported provider.' }, { status: 400 });
  }

  try {
    const models = await listProviderModels(provider as ProviderId);
    return NextResponse.json({ provider, models });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load models.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
