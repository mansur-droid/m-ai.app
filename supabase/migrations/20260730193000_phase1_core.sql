create extension if not exists pgcrypto;

create type public.message_role as enum ('system', 'user', 'assistant', 'tool');
create type public.asset_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New conversation',
  provider text,
  model text,
  agent text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.message_role not null,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null,
  model text not null,
  prompt text not null,
  revised_prompt text,
  storage_path text,
  width integer,
  height integer,
  seed bigint,
  status public.asset_status not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null,
  model text not null,
  prompt text not null,
  storage_path text,
  thumbnail_path text,
  duration_seconds numeric,
  status public.asset_status not null default 'pending',
  provider_job_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  original_name text not null,
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'dark',
  language text not null default 'en',
  default_provider text,
  default_model text,
  memory_enabled boolean not null default true,
  private_mode boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  encrypted_key text not null,
  key_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

create index conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index images_user_created_idx on public.images(user_id, created_at desc);
create index videos_user_created_idx on public.videos(user_id, created_at desc);
create index uploaded_files_user_created_idx on public.uploaded_files(user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();
create trigger videos_updated_at before update on public.videos for each row execute function public.set_updated_at();
create trigger user_settings_updated_at before update on public.user_settings for each row execute function public.set_updated_at();
create trigger api_keys_updated_at before update on public.api_keys for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.images enable row level security;
alter table public.videos enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.user_settings enable row level security;
alter table public.api_keys enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "conversations_own_all" on public.conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "messages_own_all" on public.messages for all using (auth.uid() = user_id) with check (
  auth.uid() = user_id and exists (
    select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()
  )
);
create policy "images_own_all" on public.images for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "videos_own_all" on public.videos for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "uploaded_files_own_all" on public.uploaded_files for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "settings_own_all" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- API key ciphertext is intentionally inaccessible from the browser. Only trusted server code
-- using the service role may read or mutate this table after encrypting values application-side.
revoke all on public.api_keys from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.images to authenticated;
grant select, insert, update, delete on public.videos to authenticated;
grant select, insert, update, delete on public.uploaded_files to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
