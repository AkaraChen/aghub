ALTER TABLE agent_provider_bindings
ADD COLUMN haiku_model TEXT;

ALTER TABLE agent_provider_bindings
ADD COLUMN sonnet_model TEXT;

ALTER TABLE agent_provider_bindings
ADD COLUMN opus_model TEXT;
