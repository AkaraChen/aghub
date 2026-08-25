const ENV_KEY_RE = /^[\w.-]+$/u;
const WHITESPACE_RE = /\s/u;
const ESCAPED_NEWLINE_RE = /\\n/gu;
const ESCAPED_CARRIAGE_RETURN_RE = /\\r/gu;

function envSeparatorIndex(line: string): number {
	const equalsIndex = line.indexOf("=");
	let colonIndex = -1;
	for (let index = 0; index < line.length - 1; index += 1) {
		if (line[index] === ":" && WHITESPACE_RE.test(line[index + 1] ?? "")) {
			colonIndex = index;
			break;
		}
	}

	if (equalsIndex < 0) return colonIndex;
	if (colonIndex < 0) return equalsIndex;
	return Math.min(equalsIndex, colonIndex);
}

function closingQuoteIndex(value: string, quote: string): number {
	let isEscaped = false;
	for (let index = 1; index < value.length; index += 1) {
		const character = value[index];
		if (character === quote && !isEscaped) return index;
		isEscaped = character === "\\" ? !isEscaped : false;
	}
	return -1;
}

function envEntryStart(line: string) {
	let entry = line.trimStart();
	if (
		entry.startsWith("export") &&
		WHITESPACE_RE.test(entry["export".length] ?? "")
	) {
		entry = entry.slice("export".length).trimStart();
	}

	const separatorIndex = envSeparatorIndex(entry);
	if (separatorIndex < 0) return null;
	const key = entry.slice(0, separatorIndex).trim();
	if (!ENV_KEY_RE.test(key)) return null;
	return {
		key,
		rawValue: entry.slice(separatorIndex + 1).trimStart(),
	};
}

export function parseEnvText(text: string): Record<string, string> {
	const entries: Record<string, string> = {};
	const lines = text.replace(/\r\n?/gu, "\n").split("\n");

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const start = envEntryStart(lines[lineIndex] ?? "");
		if (!start) continue;

		const quote = start.rawValue[0];
		if (quote !== '"' && quote !== "'" && quote !== "`") {
			entries[start.key] = start.rawValue.split("#", 1)[0]?.trim() ?? "";
			continue;
		}

		let quotedValue = start.rawValue;
		let closingIndex = closingQuoteIndex(quotedValue, quote);
		while (closingIndex < 0 && lineIndex + 1 < lines.length) {
			lineIndex += 1;
			quotedValue += `\n${lines[lineIndex] ?? ""}`;
			closingIndex = closingQuoteIndex(quotedValue, quote);
		}
		if (closingIndex < 0) continue;

		let value = quotedValue.slice(1, closingIndex);
		if (quote === '"') {
			value = value
				.replace(ESCAPED_NEWLINE_RE, "\n")
				.replace(ESCAPED_CARRIAGE_RETURN_RE, "\r");
		}
		entries[start.key] = value;
	}

	return entries;
}
