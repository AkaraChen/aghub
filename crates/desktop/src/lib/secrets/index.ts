import { appDataDir } from "@tauri-apps/api/path";
import { Client, Stronghold } from "@tauri-apps/plugin-stronghold";
import { migrateSecrets } from "./migrations";

let stronghold: Stronghold | null = null;
let client: Client | null = null;

const VAULT_PATH = "vault.hold";
const CLIENT_NAME = "secrets";

export async function initSecrets(password: string): Promise<void> {
	if (stronghold) return;

	const vaultPath = `${await appDataDir()}${VAULT_PATH}`;
	stronghold = await Stronghold.load(vaultPath, password);

	try {
		client = await stronghold.loadClient(CLIENT_NAME);
	} catch {
		client = await stronghold.createClient(CLIENT_NAME);
	}

	await migrateSecrets(client);
}

export async function getSecretClient(): Promise<Client> {
	if (!client) {
		throw new Error("Secrets not initialized. Call initSecrets first.");
	}
	return client;
}

export async function saveSecrets(): Promise<void> {
	if (!stronghold) {
		throw new Error("Secrets not initialized.");
	}
	await stronghold.save();
}

export function clearSecretsCache(): void {
	stronghold = null;
	client = null;
}
