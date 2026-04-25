const SEMANTIC_VERSION_REGEX = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const GIT_HASH_REGEX = /^[0-9a-f]{7,40}$/i;

/**
 * Format a raw plugin version string for display.
 * - "latest" → "latest"
 * - "v1.2.3" → "v1.2.3"
 * - "1.2.3" → "v1.2.3"
 * - "abc1234" (git hash) → "#abc1234"
 * - "#abc1234" → "#abc1234"
 */
export function formatPluginVersion(version: string): string {
	if (!version) {
		return "unknown";
	}

	if (version === "latest" || version.startsWith("v")) {
		return version;
	}

	if (version.startsWith("#")) {
		return version;
	}

	if (GIT_HASH_REGEX.test(version)) {
		return `#${version}`;
	}

	if (SEMANTIC_VERSION_REGEX.test(version)) {
		return `v${version}`;
	}

	return version;
}
