import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	getTrustedSkills,
	setTrustedSkills,
	type TrustedSkill,
} from "../lib/store";

const TRUSTED_SKILLS_QUERY_KEY = ["trustedSkills"] as const;

/**
 * User-trusted audit assessments. The list and detail views hide a warning only
 * until the content, detector rules, or policy changes. Backed by plugin-store,
 * mirroring {@link useFavorites}.
 */
export function useTrustedSkills() {
	const queryClient = useQueryClient();

	const { data: trustedSkills = [] } = useQuery({
		queryKey: TRUSTED_SKILLS_QUERY_KEY,
		queryFn: getTrustedSkills,
	});

	const isSkillTrusted = useCallback(
		(name: string, assessmentDigest: string) =>
			trustedSkills.some(
				(skill) =>
					skill.name === name &&
					skill.assessment_digest === assessmentDigest,
			),
		[trustedSkills],
	);

	const setSkillTrusted = useCallback(
		async (name: string, assessmentDigest: string, trusted: boolean) => {
			const matchesIdentity = (skill: TrustedSkill) =>
				skill.name === name &&
				skill.assessment_digest === assessmentDigest;
			const next = trusted
				? [
						...trustedSkills.filter((skill) => skill.name !== name),
						{ name, assessment_digest: assessmentDigest },
					]
				: trustedSkills.filter((skill) => !matchesIdentity(skill));

			queryClient.setQueryData(TRUSTED_SKILLS_QUERY_KEY, next);
			await setTrustedSkills(next);
		},
		[trustedSkills, queryClient],
	);

	return {
		trustedSkills,
		isSkillTrusted,
		setSkillTrusted,
	};
}
