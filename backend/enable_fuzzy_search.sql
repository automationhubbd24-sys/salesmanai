-- Enable the pg_trgm extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create a function for fuzzy product search
CREATE OR REPLACE FUNCTION search_products_fuzzy(
  search_query TEXT, 
  p_user_id UUID, 
  p_page_id TEXT
)
RETURNS TABLE (
  id BIGINT,
  name TEXT,
  description TEXT,
  image_url TEXT,
  variants JSONB,
  is_active BOOLEAN,
  price NUMERIC,
  currency TEXT,
  allowed_page_ids TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id, p.name, p.description, p.image_url, p.variants, p.is_active, p.price, p.currency, p.allowed_page_ids
  FROM products p
  WHERE p.user_id = p_user_id
  AND p.is_active = true
  AND (
      -- Strict Visibility: If page_id provided, must match
      p_page_id IS NULL OR p.allowed_page_ids @> ARRAY[p_page_id]
  )
  AND (
    p.name ILIKE '%' || search_query || '%' 
    OR p.description ILIKE '%' || search_query || '%'
    OR similarity(p.name, search_query) > 0.1 -- Low threshold for typos
  )
  ORDER BY similarity(p.name, search_query) DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;
