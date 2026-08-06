import { toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import {
	DEFAULT_SKILL_PREFERENCES,
	type SkillPreferences,
} from "../../lib/store";
import {
	formatUniversalSkillTargetMembers,
	getUniversalSkillTargetLabel,
} from "../../lib/skill-targets";
import {
	setSkillPreferencesMutationOptions,
	skillPreferencesQueryOptions,
} from "../../requests/preferences";
import {
	SkillContentPreferences,
	SkillInstallationPreferences,
	SkillRelationshipPreferences,
} from "./skill-preference-sections";
import { SkillDiscoveryPreferences } from "./skill-discovery-preferences";

export default function SkillPreferencesPanel() {
	const { t, i18n } = useTranslation();
	const { allAgents } = useAgentAvailability();
	const queryClient = useQueryClient();
	const { data: preferences = DEFAULT_SKILL_PREFERENCES, isPending } =
		useQuery(skillPreferencesQueryOptions());
	const mutation = useMutation({
		...setSkillPreferencesMutationOptions(queryClient),
		onError: () => toast.danger(t("skillPreferencesError")),
	});
	const isDisabled = isPending || mutation.isPending;
	const save = (next: SkillPreferences) => mutation.mutate(next);
	const universalMembers = formatUniversalSkillTargetMembers(
		allAgents,
		i18n.language,
		"global",
	);

	return (
		<div className="grid items-start gap-4 xl:grid-cols-2">
			<div className="space-y-4">
				<SkillInstallationPreferences
					universalTargetLabel={getUniversalSkillTargetLabel(
						t,
						universalMembers,
					)}
				/>
				<SkillRelationshipPreferences
					preferences={preferences}
					isDisabled={isDisabled}
					onChange={save}
				/>
			</div>
			<div className="space-y-4">
				<SkillContentPreferences
					preferences={preferences}
					isDisabled={isDisabled}
					onChange={save}
				/>
				<SkillDiscoveryPreferences
					preferences={preferences}
					isDisabled={isDisabled}
					onChange={save}
				/>
			</div>
		</div>
	);
}
