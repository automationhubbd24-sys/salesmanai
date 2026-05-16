-- Migration to add Earning and Developer API features

-- 1. Update Users table for Earning status
ALTER TABLE users ADD COLUMN IF NOT EXISTS earning_status TEXT DEFAULT 'none'; -- 'none', 'pending', 'approved', 'rejected'
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_earner BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS earning_balance NUMERIC DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unpaid_calls INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_earnings NUMERIC DEFAULT 0;

-- 2. Update api_list table to track ownership and modes
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'admin'; -- 'admin', 'earn', 'dev'
ALTER TABLE api_list ADD COLUMN IF NOT EXISTS unpaid_calls INTEGER DEFAULT 0; -- Calls tracked for payment (for 'earn' mode)

-- 3. Create a table for Earning Registration Requests (to track the 5K BDT fee)
CREATE TABLE IF NOT EXISTS earner_registrations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES users(id) NOT NULL,
    payment_method TEXT,
    transaction_id TEXT UNIQUE,
    amount NUMERIC DEFAULT 5000,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earner_reg_user ON earner_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_earner_reg_status ON earner_registrations(status);
