-- Run in Supabase SQL Editor if you already created blog_posts (v1 schema).

alter table blog_posts add column if not exists entry_type text not null default 'post';
alter table blog_posts add column if not exists thumbnail_url text;

alter table blog_posts drop constraint if exists blog_posts_entry_type_check;
alter table blog_posts add constraint blog_posts_entry_type_check
  check (entry_type in ('post', 'journal'));

-- Journal entries don't need titles
alter table blog_posts alter column title drop not null;

-- Storage bucket for post thumbnails (public read)
insert into storage.buckets (id, name, public)
values ('blog-thumbnails', 'blog-thumbnails', true)
on conflict (id) do nothing;

drop policy if exists "Admins upload thumbnails" on storage.objects;
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

-- Allow anyone to read posts (blog is public); writes stay admin-only
drop policy if exists "Admins read posts" on blog_posts;
drop policy if exists "Public read posts" on blog_posts;

create policy "Public read posts"
  on blog_posts for select
  to anon, authenticated
  using (true);
