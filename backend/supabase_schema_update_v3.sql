-- Add allowed_page_ids column to products for Page-Specific Visibility
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS allowed_page_ids TEXT[] DEFAULT NULL;

-- If allowed_page_ids is NULL, it means "All Pages" (Backward Compatibility).
-- If it's an empty array '{}', it means "No Pages" (Hidden).
