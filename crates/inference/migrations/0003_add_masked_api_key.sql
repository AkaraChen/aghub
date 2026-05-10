ALTER TABLE inference_providers
ADD COLUMN masked_api_key TEXT NOT NULL DEFAULT '';
