-- 08_add_pgvector_for_product_search.sql
-- Step 1: Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add embedding column to products table
-- Gemini embeddings are 768 dimensions (for text-embedding-004) or 1536 (for older models).
-- We'll use 768 as it's the current standard for text-embedding-004, but we can adjust if needed.
ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Step 3: Add an index for faster similarity search (HNSW index)
-- This improves performance for large datasets.
CREATE INDEX IF NOT EXISTS idx_products_embedding ON products USING hnsw (embedding vector_cosine_ops);
