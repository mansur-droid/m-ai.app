import { redirect } from 'next/navigation';
import ChatWorkspace from '@/components/chat-workspace';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login?next=/');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  const displayName = profile?.display_name?.trim()
    || user.user_metadata?.display_name?.trim()
    || user.email?.split('@')[0]
    || 'User';

  return <ChatWorkspace displayName={displayName} />;
}
