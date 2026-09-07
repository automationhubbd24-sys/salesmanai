-- 08_add_pgvector_for_product_search.sql
-- Step 1: Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add embedding column to products table
-- OpenRouter qwen/qwen3-embedding-8b returns 4096 dimensions.
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(4096);

-- Step 3: Add an index for faster similarity search (HNSW index)
-- This improves performance for large datasets.
CREATE INDEX IF NOT EXISTS idx_products_embedding ON products USING hnsw (embedding vector_cosine_ops);
