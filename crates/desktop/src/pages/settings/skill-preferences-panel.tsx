import { toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
	DEFAULT_SKILL_PREFERENCES,
	type SkillPreferences,
} from "../../lib/store";
import {
	setSkillPreferencesMutationOptions,
	skillPreferencesQueryOptions,
} from "../../requests/preferences";
import {
	SkillContentPreferences,
	SkillRelationshipPreferences,
} from "./skill-preference-sections";
import { SkillDiscoveryPreferences } from "./skill-discovery-preferences";

export default function SkillPreferencesPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const { data: preferences = DEFAULT_SKILL_PREFERENCES, isPending } =
		useQuery(skillPreferencesQueryOptions());
	const mutation = useMutation({
		...setSkillPreferencesMutationOptions(queryClient),
		onError: () => toast.danger(t("skillPreferencesError")),
	});
	const isDisabled = isPending || mutation.isPending;
	const save = (next: SkillPreferences) => mutation.mutate(next);

	return (
		<div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
			<div className="min-w-0">
				<SkillContentPreferences
					preferences={preferences}
					isDisabled={isDisabled}
					onChange={save}
				/>
			</div>
			<div className="min-w-0 space-y-4">
				<SkillRelationshipPreferences
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
