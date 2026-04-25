CREATE TABLE IF NOT EXISTS inference_providers (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    format       TEXT NOT NULL,
    api_base_url TEXT NOT NULL
);
