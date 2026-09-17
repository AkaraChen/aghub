import { useQueryState } from "nuqs";
import { cn } from "../../lib/utils";
import { SkillsHeader } from "./components/skills-header";
import SkillsSearchPage from "./search";

export default function SkillsShPage() {
	const [query, setQuery] = useQueryState("q", {
		defaultValue: "",
		history: "push",
	});
	const submittedQuery = query.trim();
	const hasQuery = submittedQuery.length >= 2;
	return (
		<div className="flex h-full min-h-0 flex-col gap-2.5 overflow-hidden p-4 sm:p-6">
			<div
				className={cn(
					"shrink-0",
					!hasQuery && "mx-auto w-full max-w-[480px] pt-[20vh]",
				)}
			>
				{!hasQuery && (
					<h2 className="mb-10 text-center text-2xl font-medium tracking-tight">
						skills.sh
					</h2>
				)}
				<SkillsHeader
					key={`header:${submittedQuery}`}
					initialQuery={submittedQuery}
					onSearch={(value) => void setQuery(value)}
				/>
			</div>
			{hasQuery && (
				<SkillsSearchPage key={submittedQuery} query={submittedQuery} />
			)}
		</div>
	);
}
