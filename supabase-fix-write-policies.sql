-- Run in Supabase → SQL Editor if saves/updates return 0 rows.
-- Fixes missing INSERT / UPDATE / DELETE policies on blog_posts.

alter table blog_posts enable row level security;

drop policy if exists "Admins insert posts" on blog_posts;
drop policy if exists "Admins update posts" on blog_posts;
drop policy if exists "Admins delete posts" on blog_posts;
drop policy if exists "Public read posts" on blog_posts;

create policy "Public read posts"
  on blog_posts for select
  to anon, authenticated
  using (true);

create policy "Admins insert posts"
  on blog_posts for insert
  to authenticated
  with check (true);

create policy "Admins update posts"
  on blog_posts for update
  to authenticated
  using (true)
  with check (true);

create policy "Admins delete posts"
  on blog_posts for delete
  to authenticated
  using (true);
