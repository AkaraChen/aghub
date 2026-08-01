import { getStore } from ".";

const ACKNOWLEDGED_ASSESSMENTS_KEY = "acknowledgedSkillAssessments";

export interface AcknowledgedSkillAssessment {
	name: string;
	assessment_digest: string;
}

function isAcknowledgedSkillAssessment(
	value: unknown,
): value is AcknowledgedSkillAssessment {
	if (typeof value !== "object" || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.name === "string" &&
		typeof candidate.assessment_digest === "string"
	);
}

export async function getAcknowledgedSkillAssessments(): Promise<
	AcknowledgedSkillAssessment[]
> {
	const store = await getStore();
	const value = await store.get<unknown>(ACKNOWLEDGED_ASSESSMENTS_KEY);
	return Array.isArray(value)
		? value.filter(isAcknowledgedSkillAssessment)
		: [];
}

export async function setAcknowledgedSkillAssessments(
	assessments: AcknowledgedSkillAssessment[],
): Promise<void> {
	const store = await getStore();
	await store.set(ACKNOWLEDGED_ASSESSMENTS_KEY, assessments);
	await store.save();
}
