import { getStore } from ".";

const SKILL_AUDIT_ENABLED_KEY = "skillAuditEnabled";
const DEFAULT_SKILL_AUDIT_ENABLED = true;

export async function getSkillAuditEnabled(): Promise<boolean> {
	const store = await getStore();
	const value = await store.get<boolean>(SKILL_AUDIT_ENABLED_KEY);
	return typeof value === "boolean" ? value : DEFAULT_SKILL_AUDIT_ENABLED;
}

export async function setSkillAuditEnabled(enabled: boolean): Promise<boolean> {
	const store = await getStore();
	await store.set(SKILL_AUDIT_ENABLED_KEY, enabled);
	await store.save();
	return enabled;
}
