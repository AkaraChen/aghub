import type { TransportDto } from "./api-types";

// Static regex patterns to avoid re-compilation on every call
const BASE64URL_DASH_REGEX = /-/g;
const BASE64URL_UNDERSCORE_REGEX = /_/g;
const LEADING_SLASH_REGEX = /^\//;

export type DeepLinkImportIntent =
	| {
			kind: "skill-market-install";
			rawUrl: string;
			source: string;
			name: string;
			title?: string;
			author?: string;
			description?: string;
	  }
	| {
			kind: "mcp-config-install";
			rawUrl: string;
			name: string;
			transport: TransportDto;
			timeout?: number;
	  };

export type ParseDeepLinkResult =
	| { ok: true; intent: DeepLinkImportIntent }
	| { ok: false; error: string };

interface ParsedMcpPayload {
	name: string;
	transport: TransportDto;
	timeout?: number;
}

function decodeBase64Url(value: string): string {
	const normalized = value
		.replace(BASE64URL_DASH_REGEX, "+")
		.replace(BASE64URL_UNDERSCORE_REGEX, "/");
	const paddingLength = (4 - (normalized.length % 4)) % 4;
	const padded = normalized.padEnd(normalized.length + paddingLength, "=");
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringMap(value: unknown): value is Record<string, string> {
	return (
		!value ||
		(isRecord(value) &&
			Object.values(value).every((entry) => typeof entry === "string"))
	);
}

function isTransportDto(value: unknown): value is TransportDto {
	if (!isRecord(value) || typeof value.type !== "string") {
		return false;
	}

	if (value.type === "stdio") {
		return (
			typeof value.command === "string" &&
			(value.args === undefined ||
				(Array.isArray(value.args) &&
					value.args.every((entry) => typeof entry === "string"))) &&
			isStringMap(value.env)
		);
	}

	if (value.type === "sse" || value.type === "streamable_http") {
		return typeof value.url === "string" && isStringMap(value.headers);
	}

	return false;
}

function parseMcpPayload(payload: string): ParsedMcpPayload {
	const decoded = decodeBase64Url(payload);
	const parsed = JSON.parse(decoded) as unknown;

	if (
		!isRecord(parsed) ||
		typeof parsed.name !== "string" ||
		!isTransportDto(parsed.transport)
	) {
		throw new Error("invalid");
	}

	if (parsed.timeout !== undefined && typeof parsed.timeout !== "number") {
		throw new Error("invalid");
	}

	return {
		name: parsed.name,
		transport: parsed.transport,
		timeout: parsed.timeout,
	};
}

export function parseDeepLink(rawUrl: string): ParseDeepLinkResult {
	let url: URL;

	try {
		url = new URL(rawUrl);
	} catch {
		return { ok: false, error: "deepLinkInvalidUrl" };
	}

	const route = url.hostname || url.pathname.replace(LEADING_SLASH_REGEX, "");
	if (url.protocol !== "aghub:" || route !== "import") {
		return { ok: false, error: "deepLinkUnsupported" };
	}

	const type = url.searchParams.get("type");

	if (type === "skill") {
		const source = url.searchParams.get("source")?.trim();
		const name = url.searchParams.get("name")?.trim();

		if (!source || !name) {
			return { ok: false, error: "deepLinkInvalidSkill" };
		}

		return {
			ok: true,
			intent: {
				kind: "skill-market-install",
				rawUrl,
				source,
				name,
				title: url.searchParams.get("title")?.trim() || undefined,
				author: url.searchParams.get("author")?.trim() || undefined,
				description:
					url.searchParams.get("description")?.trim() || undefined,
			},
		};
	}

	if (type === "mcp") {
		const payload = url.searchParams.get("payload")?.trim();
		if (!payload) {
			return { ok: false, error: "deepLinkInvalidMcp" };
		}

		try {
			const parsed = parseMcpPayload(payload);
			return {
				ok: true,
				intent: {
					kind: "mcp-config-install",
					rawUrl,
					name: parsed.name,
					transport: parsed.transport,
					timeout: parsed.timeout,
				},
			};
		} catch {
			return { ok: false, error: "deepLinkInvalidMcp" };
		}
	}

	return { ok: false, error: "deepLinkUnsupportedType" };
}

export function formatTransportSummary(transport: TransportDto): string {
	if (transport.type === "stdio") {
		return transport.args && transport.args.length > 0
			? `${transport.command} ${transport.args.join(" ")}`
			: transport.command;
	}

	return transport.url;
}
