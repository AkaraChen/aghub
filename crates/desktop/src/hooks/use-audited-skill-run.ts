import { useCallback, useEffect, useRef } from "react";

export interface AuditedSkillRun<TCandidate> {
	readonly candidate: TCandidate;
	isCurrent: () => boolean;
}

export function useAuditedSkillRun() {
	const generationRef = useRef(0);

	useEffect(
		() => () => {
			generationRef.current += 1;
		},
		[],
	);

	const beginAuditedSkillRun = useCallback(
		<TCandidate>(candidate: TCandidate) => {
			const runGeneration = generationRef.current + 1;
			generationRef.current = runGeneration;

			return {
				candidate,
				isCurrent: () => generationRef.current === runGeneration,
			} satisfies AuditedSkillRun<TCandidate>;
		},
		[],
	);

	const invalidateAuditedSkillRun = useCallback(() => {
		generationRef.current += 1;
	}, []);

	return { beginAuditedSkillRun, invalidateAuditedSkillRun };
}
