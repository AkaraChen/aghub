import { Button, SearchField, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";

type Size = "large" | "compact";

interface SkillsHeaderProps {
	size: Size;
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	onSearch: () => void;
	showSearchButton?: boolean;
}

export function SkillsHeader({
	size,
	searchQuery,
	onSearchQueryChange,
	onSearch,
	showSearchButton = true,
}: SkillsHeaderProps) {
	const { t } = useTranslation();

	const isLarge = size === "large";
	const textSize = isLarge ? "text-2xl" : "text-lg";
	const gap = isLarge ? "gap-2.5" : "gap-2";
	const marginBottom = isLarge ? "mb-5" : "";

	return (
		<div className={`flex items-center ${gap} ${marginBottom}`}>
			<Tooltip delay={0}>
				<Tooltip.Trigger>
					<span
						className={`font-medium tracking-tight ${textSize} cursor-default`}
					>
						skills.sh
					</span>
				</Tooltip.Trigger>
				<Tooltip.Content>{t("dataFromSkillsSh")}</Tooltip.Content>
			</Tooltip>
			{showSearchButton && (
				<div className="flex items-center gap-2">
					<SearchField
						value={searchQuery}
						onChange={onSearchQueryChange}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								onSearch();
							}
						}}
						aria-label={t("searchMarketSkills")}
						className="w-[400px]"
					>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input
								placeholder={t("searchMarketSkillsPlaceholder")}
							/>
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>
					<Button
						onPress={onSearch}
						isDisabled={searchQuery.trim().length < 2}
					>
						{t("search")}
					</Button>
				</div>
			)}
		</div>
	);
}
