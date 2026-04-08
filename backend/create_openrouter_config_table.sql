create table if not exists public.openrouter_engine_config ( 
   id uuid not null default gen_random_uuid (), 
   config_type text null default 'best_models'::text, 
   text_model text null, 
   voice_model text null, 
   image_model text null, 
   text_model_details jsonb null, 
   voice_model_details jsonb null, 
   image_model_details jsonb null, 
   updated_at timestamp with time zone null default now(), 
   constraint openrouter_engine_config_pkey primary key (id), 
   constraint openrouter_engine_config_config_type_key unique (config_type) 
 ) TABLESPACE pg_default;
