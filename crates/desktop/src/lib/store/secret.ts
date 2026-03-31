import { appDataDir } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";
import type { GitHubCredential } from "./types";

let stronghold: Stronghold | null = null;
let client: Client | null = null;

const VAULT_PATH = "vault.hold";
const CLIENT_NAME = "secrets";
const GITHUB_KEY = "github_credential";

async function initSecretStore(password: string): Promise<void> {
	const vaultPath = `${await appDataDir()}${VAULT_PATH}`;
	stronghold = await Stronghold.load(vaultPath, password);

	try {
		client = await stronghold.loadClient(CLIENT_NAME);
	} catch {
		client = await stronghold.createClient(CLIENT_NAME);
	}
}

async function getSecretStore(): Promise<Client> {
	if (!client) {
		throw new Error(
			"Secret store not initialized. Call initSecretStore first.",
		);
	}
	return client;
}

async function insertRecord(key: string, value: string): Promise<void> {
	const client = await getSecretStore();
	const store = client.getStore();
	const data = Array.from(new TextEncoder().encode(value));
	await store.insert(key, data);
}

async function getRecord(key: string): Promise<string | null> {
	const client = await getSecretStore();
	const store = client.getStore();
	try {
		const data = await store.get(key);
		if (!data) return null;
		return new TextDecoder().decode(new Uint8Array(data));
	} catch {
		return null;
	}
}

async function removeRecord(key: string): Promise<void> {
	const client = await getSecretStore();
	const store = client.getStore();
	await store.remove(key);
}

async function saveSecretStore(): Promise<void> {
	if (!stronghold) {
		throw new Error("Secret store not initialized.");
	}
	await stronghold.save();
}

export async function saveGitHubCredential(
	credential: GitHubCredential,
	password: string,
): Promise<void> {
	if (!stronghold) {
		await initSecretStore(password);
	}

	const jsonValue = JSON.stringify(credential);
	await insertRecord(GITHUB_KEY, jsonValue);
	await saveSecretStore();
}

export async function getGitHubCredential(
	password: string,
): Promise<GitHubCredential | null> {
	if (!stronghold) {
		await initSecretStore(password);
	}

	const jsonValue = await getRecord(GITHUB_KEY);
	if (!jsonValue) return null;

	return JSON.parse(jsonValue) as GitHubCredential;
}

export async function removeGitHubCredential(password: string): Promise<void> {
	if (!stronghold) {
		await initSecretStore(password);
	}

	await removeRecord(GITHUB_KEY);
	await saveSecretStore();
}
