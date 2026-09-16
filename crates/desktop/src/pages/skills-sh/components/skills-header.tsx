import { Button, SearchField } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function SkillsHeader({
	initialQuery,
	onSearch,
}: {
	initialQuery: string;
	onSearch: (query: string) => void;
}) {
	const { t } = useTranslation();
	const [searchQuery, setSearchQuery] = useState(initialQuery);
	const handleSearch = () => {
		const query = searchQuery.trim();
		if (query.length >= 2) onSearch(query);
	};
	return (
		<div className="flex shrink-0 items-center gap-2">
			<SearchField
				variant="secondary"
				value={searchQuery}
				onChange={setSearchQuery}
				onSubmit={handleSearch}
				aria-label={t("searchMarketSkills")}
				className="min-w-0 flex-1"
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
				variant="secondary"
				onPress={handleSearch}
				isDisabled={searchQuery.trim().length < 2}
			>
				{t("search")}
			</Button>
		</div>
	);
}
