import { createApi } from "../lib/api";

export type ApiClient = ReturnType<typeof createApi>;

const clients = new Map<string, ApiClient>();

export function getApiClient(baseUrl: string, authToken: string): ApiClient {
	const key = `${baseUrl}:${authToken}`;
	const existing = clients.get(key);

	if (existing) {
		return existing;
	}

	const client = createApi(baseUrl, authToken);
	clients.set(key, client);
	return client;
}
