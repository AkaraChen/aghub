import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	type AcknowledgedSkillAssessment,
	getAcknowledgedSkillAssessments,
	setAcknowledgedSkillAssessments,
} from "../lib/store";

const ACKNOWLEDGED_ASSESSMENTS_QUERY_KEY = [
	"acknowledgedSkillAssessments",
] as const;

export function useAuditAcknowledgements() {
	const queryClient = useQueryClient();

	const { data: acknowledgedAssessments = [] } = useQuery({
		queryKey: ACKNOWLEDGED_ASSESSMENTS_QUERY_KEY,
		queryFn: getAcknowledgedSkillAssessments,
	});

	const isAssessmentAcknowledged = useCallback(
		(name: string, assessmentDigest: string) =>
			acknowledgedAssessments.some(
				(assessment) =>
					assessment.name === name &&
					assessment.assessment_digest === assessmentDigest,
			),
		[acknowledgedAssessments],
	);

	const setAssessmentAcknowledged = useCallback(
		async (
			name: string,
			assessmentDigest: string,
			acknowledged: boolean,
		) => {
			const matchesIdentity = (assessment: AcknowledgedSkillAssessment) =>
				assessment.name === name &&
				assessment.assessment_digest === assessmentDigest;
			const next = acknowledged
				? [
						...acknowledgedAssessments.filter(
							(assessment) => assessment.name !== name,
						),
						{ name, assessment_digest: assessmentDigest },
					]
				: acknowledgedAssessments.filter(
						(assessment) => !matchesIdentity(assessment),
					);

			queryClient.setQueryData(ACKNOWLEDGED_ASSESSMENTS_QUERY_KEY, next);
			try {
				await setAcknowledgedSkillAssessments(next);
			} catch (error) {
				queryClient.setQueryData(
					ACKNOWLEDGED_ASSESSMENTS_QUERY_KEY,
					acknowledgedAssessments,
				);
				throw error;
			}
		},
		[acknowledgedAssessments, queryClient],
	);

	return {
		acknowledgedAssessments,
		isAssessmentAcknowledged,
		setAssessmentAcknowledged,
	};
}
