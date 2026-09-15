-- Run once in the same project's SQL Editor AFTER 001_supabase.sql.
-- Contains no library content or credentials. All RPCs require authenticated auth.uid().
begin;
create table public.paper_library_changes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null, revision bigint not null, deleted boolean not null,
  primary key (owner_id, paper_id)
);
create index paper_library_changes_revision on public.paper_library_changes (owner_id, revision, paper_id);
create table public.paper_library_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null, payload_hash text not null, revision bigint not null,
  created_at timestamptz not null default now(), primary key (owner_id, operation_id)
);
do $$ declare name text; item record; begin
  foreach name in array array['paper_library_changes','paper_library_operations'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('revoke all on public.%I from public, anon', name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', name);
    execute format('create policy own_library on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', name);
  end loop;
  -- Moving a reference/source association is checked at transaction commit.
  for item in select c.conname, c.conrelid::regclass as tab from pg_constraint c
    where c.contype = 'f' and c.conrelid in ('public.paper_library_source_members'::regclass,
      'public.paper_library_reference_groups'::regclass, 'public.paper_library_citation_records'::regclass)
  loop execute format('alter table %s alter constraint %I deferrable initially deferred', item.tab, item.conname); end loop;
end $$;
-- Preserve data imported using the phase-one schema, if any.
insert into public.paper_library_state(owner_id, revision)
  select distinct owner_id, 1 from public.paper_library_papers on conflict (owner_id) do nothing;
update public.paper_library_state s set revision = 1 where revision = 0 and exists
  (select 1 from public.paper_library_papers p where p.owner_id = s.owner_id);
insert into public.paper_library_changes(owner_id, paper_id, revision, deleted)
  select p.owner_id, p.id, s.revision, false from public.paper_library_papers p
  join public.paper_library_state s using (owner_id);

create function public.paper_library_status() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('sync_version', 1, 'revision', coalesce((select revision from public.paper_library_state where owner_id = (select auth.uid())), 0),
    'papers', (select count(*) from public.paper_library_papers where owner_id = (select auth.uid())),
    'works', (select count(*) from public.paper_library_works where owner_id = (select auth.uid())),
    'references', (select count(*) from public.paper_library_citation_records where owner_id = (select auth.uid())));
$$;

create function public.paper_library_pull(expected_revision bigint, since_revision bigint default 0, after_id text default '') returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare actual bigint; items jsonb; settings jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select revision, analysis_settings into actual, settings from public.paper_library_state where owner_id = auth.uid();
  if coalesce(actual, 0) <> expected_revision then raise exception 'cloud_revision_conflict'; end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.paper_id), '[]') into items from
    (select paper_id, deleted from public.paper_library_changes where owner_id = auth.uid()
      and revision > since_revision and paper_id > after_id order by paper_id limit 100) c;
  return jsonb_build_object('revision', coalesce(actual, 0), 'changes', items,
    'settings', case when after_id = '' then coalesce(settings, '{}'::jsonb) else null end);
end $$;

create function public.paper_library_read_papers(expected_revision bigint, paper_ids text[]) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare actual bigint; items jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce(array_length(paper_ids, 1), 0) > 50 then raise exception 'page_too_large'; end if;
  select revision into actual from public.paper_library_state where owner_id = auth.uid();
  if coalesce(actual, 0) <> expected_revision then raise exception 'cloud_revision_conflict'; end if;
  select coalesce(jsonb_agg(p.data || jsonb_build_object('reference_groups', coalesce((
    select jsonb_agg(g.data || jsonb_build_object('references', coalesce((
      select jsonb_agg(c.data order by c.position, c.id) from public.paper_library_citation_records c
      where c.owner_id = p.owner_id and c.group_id = g.id), '[]'::jsonb)) order by g.position, g.id)
    from public.paper_library_reference_groups g where g.owner_id = p.owner_id and g.paper_id = p.id), '[]'::jsonb)) order by p.position, p.id), '[]'::jsonb)
    into items from public.paper_library_papers p where p.owner_id = auth.uid() and p.id = any(paper_ids);
  return items;
end $$;

create function public.paper_library_commit(expected_revision bigint, operation_id uuid, payload jsonb) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare who uuid := auth.uid(); current_revision bigint; prior record; name text; primary_name text;
  columns_sql text; updates_sql text; item jsonb; touched text[] := '{}'; old_ids text[]; actual jsonb;
  tables text[] := array['papers','sources','source_members','works','reference_groups','citation_records'];
begin
  if who is null then raise exception 'authentication_required'; end if;
  if operation_id is null or expected_revision is null or jsonb_typeof(payload) <> 'object' then raise exception 'invalid_operation'; end if;
  insert into public.paper_library_state(owner_id) values (who) on conflict (owner_id) do nothing;
  select s.revision into current_revision from public.paper_library_state s where s.owner_id = who for update;
  select o.* into prior from public.paper_library_operations o where o.owner_id = who and o.operation_id = paper_library_commit.operation_id;
  if found then
    if prior.payload_hash <> md5(payload::text) then raise exception 'operation_payload_mismatch'; end if;
    return prior.revision;
  end if;
  if current_revision <> expected_revision then raise exception 'cloud_revision_conflict'; end if;
  current_revision := current_revision + 1;
  if payload->>'kind' = 'stars' then
    if jsonb_typeof(payload->'stars') is distinct from 'array' or jsonb_array_length(payload->'stars') = 0 then raise exception 'invalid_stars'; end if;
    for item in select value from jsonb_array_elements(payload->'stars') loop
      if jsonb_typeof(item->'starred') is distinct from 'boolean' then raise exception 'invalid_star'; end if;
      update public.paper_library_papers set data = jsonb_set(data, '{starred}', item->'starred', true)
        where owner_id = who and id = item->>'id';
      if not found then raise exception 'paper_missing'; end if;
      touched := array_append(touched, item->>'id');
    end loop;
  elsif payload->>'kind' = 'delta' then
    if jsonb_typeof(payload->'settings') is distinct from 'object' or jsonb_typeof(payload->'counts') is distinct from 'object' then raise exception 'invalid_delta'; end if;
    foreach name in array tables loop
      if jsonb_typeof(payload->'tables'->name->'puts') is distinct from 'array' or jsonb_typeof(payload->'tables'->name->'deletes') is distinct from 'array' then raise exception 'invalid_table_delta'; end if;
      primary_name := case when name = 'source_members' then 'paper_id' else 'id' end;
      if name in ('papers', 'reference_groups', 'citation_records') then
        execute format('select coalesce(array_agg(%I), ''{}'') from public.%I where owner_id = $1 and id in (select jsonb_array_elements_text($2))',
          case when name = 'papers' then 'id' else 'paper_id' end, 'paper_library_' || name)
          into old_ids using who, payload->'tables'->name->'deletes';
        touched := touched || old_ids;
        select coalesce(array_agg(value->>case when name = 'papers' then 'id' else 'paper_id' end), '{}') into old_ids
          from jsonb_array_elements(payload->'tables'->name->'puts');
        touched := touched || old_ids;
      end if;
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
        string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum) filter (where a.attname not in ('owner_id', primary_name))
        into columns_sql, updates_sql from pg_attribute a
        where a.attrelid = ('public.paper_library_' || name)::regclass and a.attnum > 0 and not a.attisdropped;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)
        on conflict (owner_id, %I) do update set %s', 'paper_library_' || name, columns_sql, columns_sql,
        'paper_library_' || name, primary_name, updates_sql)
        using (select coalesce(jsonb_agg(value || jsonb_build_object('owner_id', who)), '[]') from jsonb_array_elements(payload->'tables'->name->'puts'));
    end loop;
    foreach name in array array['citation_records','reference_groups','works','source_members','sources','papers'] loop
      primary_name := case when name = 'source_members' then 'paper_id' else 'id' end;
      execute format('delete from public.%I where owner_id = $1 and %I in (select jsonb_array_elements_text($2))', 'paper_library_' || name, primary_name)
        using who, payload->'tables'->name->'deletes';
    end loop;
    select jsonb_build_object('papers', (select count(*) from public.paper_library_papers where owner_id = who),
      'sources', (select count(*) from public.paper_library_sources where owner_id = who),
      'works', (select count(*) from public.paper_library_works where owner_id = who),
      'references', (select count(*) from public.paper_library_citation_records where owner_id = who),
      'edges', (select count(distinct (source_id, work_id)) from public.paper_library_citation_records where owner_id = who)) into actual;
    foreach name in array array['papers','sources','works','references','edges'] loop
      if actual->name is distinct from payload->'counts'->name then raise exception 'count_mismatch: %', name; end if;
    end loop;
    update public.paper_library_state set analysis_settings = payload->'settings' where owner_id = who;
  else raise exception 'invalid_operation_kind'; end if;
  insert into public.paper_library_changes(owner_id, paper_id, revision, deleted)
    select who, ids.id, current_revision, not exists (select 1 from public.paper_library_papers p where p.owner_id = who and p.id = ids.id)
      from (select distinct unnest(touched) as id) ids
    on conflict (owner_id, paper_id) do update set revision = excluded.revision, deleted = excluded.deleted;
  update public.paper_library_state set revision = current_revision, updated_at = now() where owner_id = who;
  insert into public.paper_library_operations(owner_id, operation_id, payload_hash, revision)
    values (who, operation_id, md5(payload::text), current_revision);
  -- Bound metadata growth. An older uncertain retry safely becomes a revision conflict.
  if current_revision % 100 = 0 then
    delete from public.paper_library_operations o where o.owner_id = who and o.revision < current_revision - 1000;
  end if;
  return current_revision;
end $$;

-- A revision-bound SQL ranking page; the browser retains citation contexts for detail/offline use.
create function public.paper_library_analysis(expected_revision bigint, selected_direction text default '', search_query text default '', page_size integer default 20, page_offset integer default 0) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare actual bigint; items jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select revision into actual from public.paper_library_state where owner_id = auth.uid();
  if coalesce(actual, 0) <> expected_revision then raise exception 'cloud_revision_conflict'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into items from public.paper_library_ranking(selected_direction, search_query, page_size, page_offset) r;
  return jsonb_build_object('revision', coalesce(actual, 0), 'items', items,
    'directions', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.paper_library_directions() d));
end $$;
do $$ declare signature text; begin
  foreach signature in array array['paper_library_status()', 'paper_library_pull(bigint,bigint,text)',
    'paper_library_read_papers(bigint,text[])', 'paper_library_commit(bigint,uuid,jsonb)',
    'paper_library_analysis(bigint,text,text,integer,integer)'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon';
    execute 'grant execute on function public.' || signature || ' to authenticated';
  end loop;
end $$;
commit;
