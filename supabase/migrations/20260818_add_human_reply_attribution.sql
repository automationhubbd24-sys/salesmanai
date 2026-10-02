-- Additive Team Management human-reply attribution and allocation analytics support.

ALTER TABLE public.fb_chats
    ADD COLUMN IF NOT EXISTS admin_user_id UUID,
    ADD COLUMN IF NOT EXISTS admin_email TEXT;

ALTER TABLE public.whatsapp_chats
    ADD COLUMN IF NOT EXISTS admin_user_id UUID,
    ADD COLUMN IF NOT EXISTS admin_email TEXT;

-- Supports per-admin human-reply analytics within a Facebook page.
CREATE INDEX IF NOT EXISTS idx_fb_chats_human_admin_analytics
    ON public.fb_chats (page_id, admin_user_id, created_at DESC)
    WHERE admin_user_id IS NOT NULL;

-- Supports per-admin human-reply analytics within a WhatsApp session.
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_human_admin_analytics
    ON public.whatsapp_chats (session_name, admin_user_id, created_at DESC)
    WHERE admin_user_id IS NOT NULL;

-- Supports efficient workload counts for allocated team members.
CREATE INDEX IF NOT EXISTS idx_team_order_assignments_workload
    ON public.team_order_assignments (owner_email, member_email)
    WHERE member_email IS NOT NULL;
