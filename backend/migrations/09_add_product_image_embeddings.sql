-- 09_add_product_image_embeddings.sql
-- Step 1: Ensure pgvector is enabled (should already be from 08, but good to be safe)
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Create the table for image embeddings
CREATE TABLE IF NOT EXISTS product_image_embeddings (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID,
    page_id TEXT,
    image_url TEXT NOT NULL,
    image_role TEXT NOT NULL DEFAULT 'primary', -- 'primary', 'additional', 'sku'
    embedding vector(768), -- Assuming text-embedding-3-small or clip for multimodal if supported later, sticking to 768 to match existing
    ocr_text TEXT,
    visual_tags JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 3: Add indexes for fast lookup and similarity search
CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_product_id ON product_image_embeddings(product_id);
CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_page_id ON product_image_embeddings(page_id);
CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_vector ON product_image_embeddings USING hnsw (embedding vector_cosine_ops);

-- Step 4: Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_product_image_embeddings_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_product_image_embeddings_updated_at ON product_image_embeddings;
CREATE TRIGGER update_product_image_embeddings_updated_at
BEFORE UPDATE ON product_image_embeddings
FOR EACH ROW
EXECUTE FUNCTION update_product_image_embeddings_updated_at_column();

-- Note: In a real multimodal setup, we might use a vision model to generate a text description of the image, 
-- and then use our existing text embedding model (text-embedding-3-small) on that description to create the vector.
-- This allows us to use the existing OpenAI API setup without needing a specialized image embedding endpoint right away.