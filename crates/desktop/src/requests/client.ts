import { createApi } from "../lib/api";

export type ApiClient = ReturnType<typeof createApi>;

const clients = new Map<string, ApiClient>();

export function getApiClient(baseUrl: string, token: string): ApiClient {
	const cacheKey = `${baseUrl}\0${token}`;
	const existing = clients.get(cacheKey);

	if (existing) {
		return existing;
	}

	const client = createApi(baseUrl, token);
	clients.set(cacheKey, client);
	return client;
}
