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
	const iconHeight = isLarge ? 24 : 18;
	const iconWidth = isLarge ? 24 : 18;
	const slashHeight = isLarge ? 20 : 16;
	const slashWidth = isLarge ? 20 : 16;
	const textSize = isLarge ? "text-2xl" : "text-lg";
	const gap = isLarge ? "gap-2.5" : "gap-2";
	const marginBottom = isLarge ? "mb-5" : "";

	return (
		<div className={`flex items-center ${gap} ${marginBottom}`}>
			<Tooltip delay={0}>
				<Tooltip.Trigger>
					<span className="text-muted hover:text-foreground cursor-default">
						<svg
							height={iconHeight}
							viewBox="0 0 16 16"
							width={iconWidth}
							className="text-current"
						>
							<path
								fillRule="evenodd"
								clipRule="evenodd"
								d="M8 1L16 15H0L8 1Z"
								fill="currentColor"
							/>
						</svg>
					</span>
				</Tooltip.Trigger>
				<Tooltip.Content>{t("poweredByVercel")}</Tooltip.Content>
			</Tooltip>
			<span className="text-muted">
				<svg
					height={slashHeight}
					viewBox="0 0 16 16"
					width={slashWidth}
					className="text-current"
				>
					<path
						fillRule="evenodd"
						clipRule="evenodd"
						d="M4.01526 15.3939L4.3107 14.7046L10.3107 0.704556L10.6061 0.0151978L11.9849 0.606077L11.6894 1.29544L5.68942 15.2954L5.39398 15.9848L4.01526 15.3939Z"
						fill="currentColor"
					/>
				</svg>
			</span>
			<Tooltip delay={0}>
				<Tooltip.Trigger>
					<span
						className={`font-medium tracking-tight ${textSize} cursor-default`}
					>
						Skills
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
