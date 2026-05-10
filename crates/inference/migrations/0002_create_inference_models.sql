CREATE TABLE IF NOT EXISTS inference_models (
    provider_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    PRIMARY KEY (provider_id, name),
    FOREIGN KEY (provider_id)
        REFERENCES inference_providers(id)
        ON DELETE CASCADE
);
