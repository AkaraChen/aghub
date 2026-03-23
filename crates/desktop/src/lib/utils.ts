import { type ClassValue, clsx } from "clsx";
import stableHash from "stable-hash";
import { twMerge } from "tailwind-merge";
import type { TransportDto } from "./api-types";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getMcpMergeKey(transport: TransportDto): string {
	let key: unknown;

	switch (transport.type) {
		case "stdio":
			key = {
				type: "stdio",
				command: transport.command,
				args: transport.args ? [...transport.args].sort() : [],
				env: transport.env
					? Object.entries(transport.env)
							.sort(([a], [b]) => a.localeCompare(b))
							.reduce(
								(acc, [k, v]) => ({ ...acc, [k]: v }),
								{} as Record<string, string>,
							)
					: {},
			};
			break;
		case "sse":
		case "streamable_http":
			key = {
				type: transport.type,
				url: transport.url,
				headers: transport.headers
					? Object.entries(transport.headers)
							.sort(([a], [b]) => a.localeCompare(b))
							.reduce(
								(acc, [k, v]) => ({ ...acc, [k]: v }),
								{} as Record<string, string>,
							)
					: {},
			};
			break;
	}

	return stableHash(key);
}
