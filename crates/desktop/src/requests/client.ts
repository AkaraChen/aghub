import { createApi } from "../lib/api";

export type ApiClient = ReturnType<typeof createApi>;

const clients = new Map<string, ApiClient>();

export function getApiClient(baseUrl: string): ApiClient {
	const existing = clients.get(baseUrl);

	if (existing) {
		return existing;
	}

	const client = createApi(baseUrl);
	clients.set(baseUrl, client);
	return client;
}
