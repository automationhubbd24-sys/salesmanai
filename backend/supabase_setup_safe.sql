-- 1. Create the 'product-images' bucket if it doesn't exist
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing; -- This prevents the error you saw

-- 2. Drop existing policies to avoid duplicates/errors
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Authenticated Users can Upload" on storage.objects;
drop policy if exists "Users can Update Own Images" on storage.objects;
drop policy if exists "Users can Delete Own Images" on storage.objects;

-- 3. Re-create Policy: Allow public read access to product images
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'product-images' );

-- 4. Re-create Policy: Allow authenticated users to upload images
create policy "Authenticated Users can Upload"
  on storage.objects for insert
  with check ( bucket_id = 'product-images' );

-- 5. Re-create Policy: Allow users to update their own images
create policy "Users can Update Own Images"
  on storage.objects for update
  using ( bucket_id = 'product-images' );

-- 6. Re-create Policy: Allow users to delete their own images
create policy "Users can Delete Own Images"
  on storage.objects for delete
  using ( bucket_id = 'product-images' );
