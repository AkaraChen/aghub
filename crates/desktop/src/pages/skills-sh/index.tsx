import { useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import { Empty, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import { SkillsHeader } from "./components/skills-header";
import SkillsSearchPage from "./search";

export default function SkillsShPage() {
	const { t } = useTranslation();
	const [query, setQuery] = useQueryState("q", {
		defaultValue: "",
		history: "push",
	});
	const submittedQuery = query.trim();
	return (
		<div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden p-4 sm:p-6">
			<SkillsHeader
				key={`header:${submittedQuery}`}
				initialQuery={submittedQuery}
				onSearch={(value) => void setQuery(value)}
			/>
			{submittedQuery.length >= 2 ? (
				<SkillsSearchPage key={submittedQuery} query={submittedQuery} />
			) : (
				<Empty className="border-0">
					<EmptyHeader>
						<EmptyTitle className="text-sm font-normal text-muted">
							{t("searchToFindSkills")}
						</EmptyTitle>
					</EmptyHeader>
				</Empty>
			)}
			<p className="shrink-0 border-t border-separator/70 pt-2 text-xs text-muted">
				{t("dataFromSkillsSh")}
			</p>
		</div>
	);
}
