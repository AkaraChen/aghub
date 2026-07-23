import { getStore } from ".";

export interface TrustedSkill {
	name: string;
	assessment_digest: string;
}

function isTrustedSkill(value: unknown): value is TrustedSkill {
	if (typeof value !== "object" || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.name === "string" &&
		typeof candidate.assessment_digest === "string"
	);
}

// Trust follows the exact detector assessment, so content, rule, or policy
// changes make warnings visible again.
export async function getTrustedSkills(): Promise<TrustedSkill[]> {
	const store = await getStore();
	const value = await store.get<unknown>("trustedSkills");
	return Array.isArray(value) ? value.filter(isTrustedSkill) : [];
}

export async function setTrustedSkills(skills: TrustedSkill[]): Promise<void> {
	const store = await getStore();
	await store.set("trustedSkills", skills);
	await store.save();
}
