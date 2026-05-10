-- Scope agent-provider binding ids by agent and maintain updated_at.
--
-- Binding ids can be stable public ids from agent config files. Different
-- agents may legitimately use the same id, so uniqueness must be per agent
-- rather than global.
CREATE TABLE IF NOT EXISTS agent_provider_bindings_new (
	id                   TEXT NOT NULL,
	agent_id             TEXT NOT NULL,
	inference_provider_id TEXT NOT NULL,
	model                TEXT,
	created_at           TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE (agent_id, id),
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

CREATE TRIGGER IF NOT EXISTS trg_agent_provider_bindings_updated_at
AFTER UPDATE ON agent_provider_bindings
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
	UPDATE agent_provider_bindings
	SET updated_at = datetime('now')
	WHERE agent_id = NEW.agent_id AND id = NEW.id;
END;
