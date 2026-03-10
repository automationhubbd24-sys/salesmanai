-- Migration: Add use_proxy column to engine_configs table
ALTER TABLE engine_configs ADD COLUMN IF NOT EXISTS use_proxy BOOLEAN DEFAULT FALSE;
