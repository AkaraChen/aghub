-- Remove is_active from agent_provider_bindings if it exists.
--
-- Active state should be derived from the agent's config file, not
-- stored in the database.
-- SQLite does not support DROP COLUMN IF EXISTS, so we recreate the table.
CREATE TABLE IF NOT EXISTS agent_provider_bindings_new (
	id                   TEXT PRIMARY KEY NOT NULL,
	agent_id             TEXT NOT NULL,
	inference_provider_id TEXT NOT NULL,
	model                TEXT,
	created_at           TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (inference_provider_id)
		REFERENCES inference_providers(id)
		ON DELETE CASCADE
);

INSERT INTO agent_provider_bindings_new
	(id, agent_id, inference_provider_id, model, created_at, updated_at)
SELECT
	id, agent_id, inference_provider_id, model, created_at, updated_at
FROM agent_provider_bindings;

DROP TABLE agent_provider_bindings;

ALTER TABLE agent_provider_bindings_new RENAME TO agent_provider_bindings;

CREATE INDEX IF NOT EXISTS idx_agent_provider_bindings_agent
ON agent_provider_bindings(agent_id);
