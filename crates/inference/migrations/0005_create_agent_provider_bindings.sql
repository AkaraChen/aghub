-- Agent-provider binding table.
--
-- Rationale: Claude and Codex do not natively support a multiple-provider
-- model the way OpenCode does. To keep the UI consistent (add / delete /
-- switch providers) we track bindings in our own database. Agents that
-- already have native multi-provider support (e.g. OpenCode) should NOT
-- use this table.
CREATE TABLE IF NOT EXISTS agent_provider_bindings (
	id                   TEXT PRIMARY KEY NOT NULL,
	agent_id             TEXT NOT NULL,
	inference_provider_id TEXT NOT NULL,
	is_active            INTEGER NOT NULL DEFAULT 0,
	model                TEXT,
	created_at           TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (inference_provider_id)
		REFERENCES inference_providers(id)
		ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_provider_bindings_agent
ON agent_provider_bindings(agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_provider_bindings_active
ON agent_provider_bindings(agent_id, is_active);
