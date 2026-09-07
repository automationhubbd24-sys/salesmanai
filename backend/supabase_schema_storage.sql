-- Create a new private bucket 'product-images'
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true);

-- Policy: Allow public read access to product images
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'product-images' );

-- Policy: Allow authenticated users to upload images
create policy "Authenticated Users can Upload"
  on storage.objects for insert
  with check ( bucket_id = 'product-images' and auth.role() = 'authenticated' );

-- Policy: Allow users to update their own images
create policy "Users can Update Own Images"
  on storage.objects for update
  using ( bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1] );

-- Policy: Allow users to delete their own images
create policy "Users can Delete Own Images"
  on storage.objects for delete
  using ( bucket_id = 'product-images' and auth.uid()::text = (storage.foldername(name))[1] );
