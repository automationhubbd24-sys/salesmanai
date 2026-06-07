-- Add audio_detection column to fb_message_database
ALTER TABLE public.fb_message_database 
ADD COLUMN IF NOT EXISTS audio_detection boolean DEFAULT false;
