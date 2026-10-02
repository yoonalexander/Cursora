-- Run once in the Cursora Supabase project's SQL editor. No public table access.
create table if not exists public.cursora_training_examples (
    id uuid primary key,
    label text not null check (label in ('cat','dog','house','tree','car','bicycle','rocket','fish','robot','hamburger','star','umbrella')),
    review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
    example jsonb not null,
    created_at timestamptz not null default now()
);
create index if not exists cursora_training_review_idx on public.cursora_training_examples(review_status, id);
alter table public.cursora_training_examples enable row level security;
revoke all on public.cursora_training_examples from anon, authenticated;
grant select, insert, update on public.cursora_training_examples to service_role;

create table if not exists public.cursora_collection_limits (
    collector text primary key,
    minute timestamptz not null,
    submissions integer not null
);
alter table public.cursora_collection_limits enable row level security;
revoke all on public.cursora_collection_limits from anon, authenticated;
grant select, insert, update, delete on public.cursora_collection_limits to service_role;

-- Atomic rate limiting survives separate Vercel instances. Only hashed IPs are used.
create or replace function public.cursora_collect_example(drawing jsonb, collector text)
returns text language plpgsql security invoker set search_path = '' as $$
declare hits integer;
begin
    insert into public.cursora_collection_limits as limits (collector, minute, submissions)
    values (collector, date_trunc('minute', now()), 1)
    on conflict on constraint cursora_collection_limits_pkey do update
    set minute = excluded.minute,
        submissions = case when limits.minute = excluded.minute then limits.submissions + 1 else 1 end
    returning submissions into hits;
    if hits > 30 then return 'rate_limited'; end if;
    delete from public.cursora_collection_limits where minute < now() - interval '1 day';
    insert into public.cursora_training_examples(id, label, example)
    values ((drawing->>'id')::uuid, drawing->>'label', drawing)
    on conflict (id) do nothing;
    return 'saved';
end;
$$;
revoke all on function public.cursora_collect_example(jsonb, text) from public, anon, authenticated;
grant execute on function public.cursora_collect_example(jsonb, text) to service_role;
