-- Preparation only: apply to the selected Supabase project during phase two.
-- No user content, project URL or credentials belong in this migration.
begin;
create table public.paper_library_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 3 check (schema_version = 3),
  revision bigint not null default 0 check (revision >= 0),
  analysis_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.paper_library_papers (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null, position integer not null check (position >= 0), data jsonb not null,
  primary key (owner_id, id), check (data->>'id' = id)
);
create table public.paper_library_sources (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null, title text not null, status text not null,
  notes jsonb not null default '[]'::jsonb,
  primary key (owner_id, id)
);
create table public.paper_library_source_members (
  owner_id uuid not null, paper_id text not null, source_id text not null,
  primary key (owner_id, paper_id), unique (owner_id, paper_id, source_id),
  foreign key (owner_id, paper_id) references public.paper_library_papers(owner_id, id) on delete cascade,
  foreign key (owner_id, source_id) references public.paper_library_sources(owner_id, id) on delete cascade
);
create table public.paper_library_works (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null, title text not null, authors text not null default '', year text not null default '',
  doi text not null default '', url text not null default '', review boolean not null default false,
  member_ids jsonb not null default '[]'::jsonb,
  primary key (owner_id, id)
);
create table public.paper_library_reference_groups (
  owner_id uuid not null, id text not null, paper_id text not null,
  position integer not null check (position >= 0), data jsonb not null,
  primary key (owner_id, id), unique (owner_id, id, paper_id),
  foreign key (owner_id, paper_id) references public.paper_library_papers(owner_id, id) on delete cascade
);
create table public.paper_library_citation_records (
  owner_id uuid not null, id text not null, paper_id text not null, source_id text not null,
  work_id text not null, group_id text not null, position integer not null check (position >= 0),
  direction text not null, data jsonb not null,
  primary key (owner_id, id), check (data->>'record_id' = id),
  foreign key (owner_id, paper_id, source_id) references public.paper_library_source_members(owner_id, paper_id, source_id) on delete cascade,
  foreign key (owner_id, work_id) references public.paper_library_works(owner_id, id) on delete cascade,
  foreign key (owner_id, group_id, paper_id) references public.paper_library_reference_groups(owner_id, id, paper_id) on delete cascade
);
create index citation_work_sources on public.paper_library_citation_records (owner_id, work_id, source_id);
create index citation_direction_sources on public.paper_library_citation_records (owner_id, direction, work_id, source_id);
create index citation_paper_groups on public.paper_library_citation_records (owner_id, paper_id, group_id);
create index paper_library_order on public.paper_library_papers (owner_id, position, id);

-- RLS is enforced on every exposed table, including the settings/revision row.
do $$
declare table_name text;
begin
  foreach table_name in array array['paper_library_state', 'paper_library_papers', 'paper_library_sources',
    'paper_library_source_members', 'paper_library_works', 'paper_library_reference_groups', 'paper_library_citation_records']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('create policy own_library on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', table_name);
  end loop;
end $$;

-- Query result is paginated and counts DISTINCT source papers, never occurrences.
create function public.paper_library_ranking(
  selected_direction text default '', search_query text default '', page_size integer default 20, page_offset integer default 0
) returns table (work_id text, title text, authors text, year text, doi text, cited_by bigint, global_cited_by bigint)
language sql stable security invoker set search_path = ''
as $$
  select w.id, w.title, w.authors, w.year, w.doi,
    count(distinct c.source_id) filter (where selected_direction = '' or c.direction = selected_direction) as cited_by,
    count(distinct c.source_id) as global_cited_by
  from public.paper_library_works w
  join public.paper_library_citation_records c on c.owner_id = w.owner_id and c.work_id = w.id
  where w.owner_id = (select auth.uid())
    and (search_query = '' or position(lower(search_query) in lower(concat_ws(' ', w.title, w.authors, w.year, w.doi, w.url))) > 0
      or exists (select 1 from public.paper_library_citation_records v where v.owner_id = w.owner_id and v.work_id = w.id
        and position(lower(search_query) in lower(concat_ws(' ', v.data->>'title', v.data->>'authors', v.data->>'doi', v.data->>'citation'))) > 0))
  group by w.id, w.title, w.authors, w.year, w.doi
  having count(distinct c.source_id) filter (where selected_direction = '' or c.direction = selected_direction) > 0
  order by cited_by desc, w.title, w.id
  limit greatest(1, least(coalesce(page_size, 20), 100)) offset greatest(0, coalesce(page_offset, 0));
$$;
revoke all on function public.paper_library_ranking(text, text, integer, integer) from public, anon;
grant execute on function public.paper_library_ranking(text, text, integer, integer) to authenticated;

create function public.paper_library_directions()
returns table (direction text, works bigint, sources bigint, edges bigint)
language sql stable security invoker set search_path = ''
as $$
  select c.direction, count(distinct c.work_id), count(distinct c.source_id), count(distinct (c.source_id, c.work_id))
  from public.paper_library_citation_records c
  where c.owner_id = (select auth.uid())
  group by c.direction
  order by count(distinct c.work_id) desc, c.direction;
$$;
revoke all on function public.paper_library_directions() from public, anon;
grant execute on function public.paper_library_directions() to authenticated;
commit;
