-- Migration for Developer API Registration
ALTER TABLE users ADD COLUMN IF NOT EXISTS developer_status TEXT DEFAULT 'none'; -- 'none', 'pending', 'approved', 'rejected'

CREATE TABLE IF NOT EXISTS developer_registrations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) NOT NULL,
    payment_method TEXT,
    transaction_id TEXT UNIQUE,
    amount NUMERIC DEFAULT 5000,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_reg_user ON developer_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_dev_reg_status ON developer_registrations(status);
