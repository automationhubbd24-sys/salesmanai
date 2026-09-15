ALTER TABLE products
ADD COLUMN IF NOT EXISTS visual_tags JSONB DEFAULT '[]'::jsonb;

UPDATE products
SET visual_tags = '[]'::jsonb
WHERE visual_tags IS NULL;
