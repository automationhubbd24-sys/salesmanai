-- 1. Update existing pages to be active if they are inactive or null
UPDATE page_access_token_message
SET subscription_status = 'active'
WHERE subscription_status IS NULL OR subscription_status = 'inactive';

-- 2. Change the default value for future inserts
ALTER TABLE page_access_token_message
ALTER COLUMN subscription_status SET DEFAULT 'active';
