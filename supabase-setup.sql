-- Run in Supabase → SQL Editor after creating a project.
-- Then add your admin user in Authentication → Users (email + password).

create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  post_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table blog_posts enable row level security;

drop policy if exists "Admins read posts" on blog_posts;
drop policy if exists "Admins insert posts" on blog_posts;
drop policy if exists "Admins delete posts" on blog_posts;

create policy "Admins read posts"
  on blog_posts for select
  to authenticated
  using (true);

create policy "Admins insert posts"
  on blog_posts for insert
  to authenticated
  with check (true);

create policy "Admins delete posts"
  on blog_posts for delete
  to authenticated
  using (true);

drop policy if exists "Admins update posts" on blog_posts;

create policy "Admins update posts"
  on blog_posts for update
  to authenticated
  using (true)
  with check (true);
