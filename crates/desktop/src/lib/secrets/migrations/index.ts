import { Client } from "@tauri-apps/plugin-stronghold";
import { SECRETS_CURRENT_VERSION, SECRETS_VERSION_KEY } from "../types";
import { migrateV0ToV1 } from "./v0-to-v1.js";

async function getRecord(client: Client, key: string): Promise<string | null> {
	const store = client.getStore();
	try {
		const data = await store.get(key);
		if (!data) return null;
		return new TextDecoder().decode(new Uint8Array(data));
	} catch {
		return null;
	}
}

async function insertRecord(
	client: Client,
	key: string,
	value: string,
): Promise<void> {
	const store = client.getStore();
	const data = Array.from(new TextEncoder().encode(value));
	await store.insert(key, data);
}

export async function migrateSecrets(client: Client): Promise<void> {
	const versionRecord = await getRecord(client, SECRETS_VERSION_KEY);
	const version = versionRecord ? Number.parseInt(versionRecord, 10) : 0;

	if (version === SECRETS_CURRENT_VERSION) return;

	if (version < 1) {
		await migrateV0ToV1(client);
	}

	await insertRecord(
		client,
		SECRETS_VERSION_KEY,
		String(SECRETS_CURRENT_VERSION),
	);
}
