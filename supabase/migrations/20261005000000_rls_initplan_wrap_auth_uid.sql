-- Performance: wrap auth.uid() in a scalar subquery in every RLS policy
-- that calls it directly.
--
-- Supabase's "auth_rls_initplan" advisor flags 186 policies across 56
-- tables where `auth.uid()` is evaluated PER ROW. Wrapping it as
-- `(select auth.uid())` lets the planner hoist it to an InitPlan and
-- evaluate it ONCE per query — a large win on any table scan/filter,
-- with zero change in behavior (the expression returns the same value).
-- This is the exact transform Supabase documents for the advisor.
--
-- Done as an idempotent DO loop over pg_policy so it covers every
-- current policy regardless of which migration created it, and only
-- ALTERs expressions (never drops/recreates a policy, never touches
-- roles or command). Two-pass regex (unwrap any already-wrapped call,
-- then wrap all) makes re-running a no-op. Runs in one transaction:
-- any failure rolls the whole thing back.

do $$
declare
  r record;
  nq text;
  nc text;
  stmt text;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, p.polname as name,
           pg_get_expr(p.polqual, p.polrelid)      as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where (pg_get_expr(p.polqual, p.polrelid)      ~ 'auth\.(uid|jwt|role)\(\)'
        or pg_get_expr(p.polwithcheck, p.polrelid) ~ 'auth\.(uid|jwt|role)\(\)')
  loop
    nq := r.qual;
    nc := r.wcheck;
    if nq is not null then
      nq := regexp_replace(nq, '\(\s*select\s+(auth\.(uid|jwt|role)\(\))\s*\)', '\1', 'gi');
      nq := regexp_replace(nq, '(auth\.(uid|jwt|role)\(\))', '(select \1)', 'g');
    end if;
    if nc is not null then
      nc := regexp_replace(nc, '\(\s*select\s+(auth\.(uid|jwt|role)\(\))\s*\)', '\1', 'gi');
      nc := regexp_replace(nc, '(auth\.(uid|jwt|role)\(\))', '(select \1)', 'g');
    end if;
    stmt := format('alter policy %I on %I.%I', r.name, r.sch, r.tbl);
    if nq is not null then stmt := stmt || ' using (' || nq || ')'; end if;
    if nc is not null then stmt := stmt || ' with check (' || nc || ')'; end if;
    execute stmt;
  end loop;
end $$;
