-- Run in Supabase → SQL Editor after creating a project.
-- Then add your admin user in Authentication → Users (email + password).

create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null default 'post' check (entry_type in ('post', 'journal')),
  title text,
  body text not null,
  thumbnail_url text,
  post_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table blog_posts enable row level security;

drop policy if exists "Admins read posts" on blog_posts;
drop policy if exists "Public read posts" on blog_posts;
drop policy if exists "Admins insert posts" on blog_posts;
drop policy if exists "Admins delete posts" on blog_posts;
drop policy if exists "Admins update posts" on blog_posts;

create policy "Public read posts"
  on blog_posts for select
  to anon, authenticated
  using (true);

create policy "Admins insert posts"
  on blog_posts for insert
  to authenticated
  with check (true);

create policy "Admins delete posts"
  on blog_posts for delete
  to authenticated
  using (true);

create policy "Admins update posts"
  on blog_posts for update
  to authenticated
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('blog-thumbnails', 'blog-thumbnails', true)
on conflict (id) do nothing;

drop policy if exists "Admins upload thumbnails" on storage.objects;
drop policy if exists "Admins update thumbnails" on storage.objects;
drop policy if exists "Admins delete thumbnails" on storage.objects;
drop policy if exists "Public read thumbnails" on storage.objects;

create policy "Admins upload thumbnails"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'blog-thumbnails');

create policy "Admins update thumbnails"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'blog-thumbnails');

create policy "Admins delete thumbnails"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'blog-thumbnails');

create policy "Public read thumbnails"
  on storage.objects for select
  to public
  using (bucket_id = 'blog-thumbnails');
