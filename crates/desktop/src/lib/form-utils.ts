import type { TFunction } from "i18next";

export function validateKeyPairs(
	t: TFunction,
	pairs: Array<{ key: string; value: string }>,
): Array<{ key?: string; value?: string }> {
	const errors: Array<{ key?: string; value?: string }> = pairs.map(
		() => ({}),
	);
	const seenKeys = new Map<string, number[]>();

	pairs.forEach((pair, index) => {
		const key = pair.key.trim();
		const value = pair.value.trim();

		if (!key && !value) return;
		if (!key) {
			errors[index].key = t("validationKeyRequired");
			return;
		}
		if (!value) {
			errors[index].value = t("validationValueRequired");
			return;
		}

		const existing = seenKeys.get(key) ?? [];
		existing.push(index);
		seenKeys.set(key, existing);
	});

	for (const indices of seenKeys.values()) {
		if (indices.length < 2) continue;
		for (const index of indices) {
			errors[index].key = t("validationDuplicateKey");
		}
	}

	return errors;
}

export function getKeyPairErrorMessage(
	errors: Array<{ key?: string; value?: string }>,
): string | undefined {
	for (const error of errors) {
		if (error.key) return error.key;
		if (error.value) return error.value;
	}

	return undefined;
}

export function validateHttpUrl(value: string, t: TFunction) {
	if (!value.trim()) {
		return t("validationUrlRequired");
	}

	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return t("validationUrlProtocol");
		}
	} catch {
		return t("validationUrlInvalid");
	}

	return true;
}

const POSITIVE_INTEGER_REGEX = /^\d+$/;

export function validatePositiveInteger(value: string, t: TFunction) {
	if (!value.trim()) {
		return true;
	}
	if (!POSITIVE_INTEGER_REGEX.test(value)) {
		return t("validationTimeoutPositiveInteger");
	}

	return Number.parseInt(value, 10) > 0
		? true
		: t("validationTimeoutPositiveInteger");
}
