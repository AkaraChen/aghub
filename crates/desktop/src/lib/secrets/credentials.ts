import type { Client } from "@tauri-apps/plugin-stronghold";
import { getSecretClient, saveSecrets } from "./index";
import type { GitHubCredential } from "./types";

const CREDENTIALS_KEY = "github_credentials";

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

async function removeRecord(client: Client, key: string): Promise<void> {
	const store = client.getStore();
	await store.remove(key);
}

function generateUUID(): string {
	return crypto.randomUUID();
}

export async function getCredentials(
	_password: string,
): Promise<GitHubCredential[]> {
	const client = await getSecretClient();
	const jsonValue = await getRecord(client, CREDENTIALS_KEY);
	if (!jsonValue) return [];

	try {
		return JSON.parse(jsonValue) as GitHubCredential[];
	} catch {
		return [];
	}
}

export async function saveCredential(
	password: string,
	credential: Omit<GitHubCredential, "id">,
): Promise<GitHubCredential> {
	const client = await getSecretClient();

	const existing = await getCredentials(password);
	const newCredential: GitHubCredential = {
		...credential,
		id: generateUUID(),
	};

	const updated = [...existing, newCredential];
	await insertRecord(client, CREDENTIALS_KEY, JSON.stringify(updated));
	await saveSecrets();

	return newCredential;
}

export async function removeCredential(
	password: string,
	id: string,
): Promise<void> {
	const client = await getSecretClient();

	const existing = await getCredentials(password);
	const updated = existing.filter((c) => c.id !== id);

	if (updated.length === 0) {
		await removeRecord(client, CREDENTIALS_KEY);
	} else {
		await insertRecord(client, CREDENTIALS_KEY, JSON.stringify(updated));
	}

	await saveSecrets();
}
