import { Button, SearchField } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { SkillsHeader } from "./components/skills-header";

export default function SkillsShPage() {
	const { t } = useTranslation();
	const [, setLocation] = useLocation();
	const [searchQuery, setSearchQuery] = useState("");

	const handleSearch = () => {
		if (searchQuery.trim().length >= 2) {
			setLocation(
				`/skills-sh/search?q=${encodeURIComponent(searchQuery.trim())}`,
			);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleSearch();
		}
	};

	return (
		<div className="h-full flex flex-col p-6 overflow-hidden">
			<div className="flex flex-col items-center pt-[20vh]">
				<SkillsHeader
					size="large"
					searchQuery={searchQuery}
					onSearchQueryChange={setSearchQuery}
					onSearch={handleSearch}
					showSearchButton={false}
				/>
				<div className="flex items-center gap-2 mt-5">
					<SearchField
						value={searchQuery}
						onChange={setSearchQuery}
						onKeyDown={handleKeyDown}
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
						onPress={handleSearch}
						isDisabled={searchQuery.trim().length < 2}
					>
						{t("search")}
					</Button>
				</div>
			</div>
		</div>
	);
}
