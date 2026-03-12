-- Grant 1000 credits to all users who have less than 100
UPDATE user_configs
SET message_credit = 1000
WHERE message_credit IS NULL OR message_credit < 100;

-- Ensure all users in page_access_token_message have a corresponding user_configs entry
-- Using casting to handle potential UUID vs Text type mismatch
INSERT INTO user_configs (user_id, message_credit, balance)
SELECT DISTINCT p.user_id::uuid, 1000, 0.00
FROM page_access_token_message p
WHERE p.user_id IS NOT NULL 
  AND p.user_id::text <> ''
  AND NOT EXISTS (
      SELECT 1 FROM user_configs u WHERE u.user_id::text = p.user_id::text
  );
