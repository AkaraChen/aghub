ALTER TABLE inference_providers
ADD COLUMN display_name TEXT NOT NULL DEFAULT '';

UPDATE inference_providers
SET display_name = name
WHERE display_name = '';
