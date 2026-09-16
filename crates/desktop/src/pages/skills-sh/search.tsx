import { Button, Spinner, Table } from "@heroui/react";
import { tableVariants } from "@heroui/styles";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TableComponents } from "react-virtuoso";
import { TableVirtuoso } from "react-virtuoso";
import { Empty, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import type { MarketSkill } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { marketSearchInfiniteQueryOptions } from "../../requests/market";
import { InstallModal } from "./components/install-modal";
import { useSkillInstall } from "./hooks/use-skill-install";

// Virtuoso owns the native table elements; reuse HeroUI's table styles.
const tableStyles = tableVariants({ variant: "secondary" });
const tableComponents: TableComponents<MarketSkill> = {
	Table: (props) => (
		<table
			{...props}
			aria-label="skills.sh"
			className={tableStyles.content({ className: "w-full table-fixed" })}
		/>
	),
	TableHead: (props) => <thead {...props} className={tableStyles.header()} />,
	TableBody: (props) => <tbody {...props} className={tableStyles.body()} />,
	TableRow: (props) => <tr {...props} className={tableStyles.row()} />,
};

export default function SkillsSearchPage({ query }: { query: string }) {
	const { t, i18n } = useTranslation();
	const api = useApi();

	const {
		installModalOpen,
		selectedSkill,
		selectedAgents,
		setSelectedAgents,
		installResults,
		phase,
		skillAgents,
		installAll,
		setInstallAll,
		installToProject,
		setInstallToProject,
		canInstallToProject,
		selectedProjectId,
		setSelectedProjectId,
		projects,
		skillAuditReady,
		audit,
		handleInstallClick,
		handleInstall,
		handleConfirmInstall,
		handleCloseInstallModal,
	} = useSkillInstall();

	const compactFormatter = new Intl.NumberFormat(i18n.language, {
		notation: "compact",
		compactDisplay: "short",
	});
	const {
		data,
		isPending,
		isError,
		error,
		isFetching,
		isFetchNextPageError,
		hasNextPage,
		fetchNextPage,
		refetch,
	} = useInfiniteQuery(marketSearchInfiniteQueryOptions({ api, query }));
	const results = data?.pages.flat() ?? [];
	const handleLoadMore = () => {
		if (hasNextPage && !isFetching) void fetchNextPage();
	};
	return (
		<>
			{isPending ? (
				<div className="flex flex-1 items-center justify-center">
					<Spinner />
				</div>
			) : results.length === 0 ? (
				<Empty className="border-0">
					<EmptyHeader>
						<EmptyTitle className="text-sm font-normal text-muted [overflow-wrap:anywhere]">
							{isError ? error.message : t("noResults")}
						</EmptyTitle>
					</EmptyHeader>
					{isError && (
						<Button variant="secondary" onPress={() => refetch()}>
							{t("retry")}
						</Button>
					)}
				</Empty>
			) : (
				<>
					<Table variant="secondary" className="min-h-0 flex-1">
						<TableVirtuoso
							data={results}
							components={tableComponents}
							style={{ height: "100%" }}
							defaultItemHeight={56}
							computeItemKey={(_index, skill) =>
								`${skill.source}/${skill.slug}`
							}
							endReached={() => {
								if (!isError) handleLoadMore();
							}}
							fixedHeaderContent={() => (
								<tr>
									<th
										scope="col"
										className={tableStyles.column({
											className: "w-[36%]",
										})}
									>
										{t("name")}
									</th>
									<th
										scope="col"
										className={tableStyles.column({
											className: "w-24 text-right",
										})}
									>
										{t("installs")}
									</th>
									<th
										scope="col"
										className={tableStyles.column()}
									>
										{t("source")}
									</th>
									<th
										scope="col"
										className={tableStyles.column({
											className: "w-24 text-right",
										})}
									>
										{t("actions")}
									</th>
								</tr>
							)}
							itemContent={(_index, skill) => (
								<>
									<td
										className={tableStyles.cell({
											className:
												"font-medium [overflow-wrap:anywhere]",
										})}
									>
										{skill.name}
									</td>
									<td
										className={tableStyles.cell({
											className:
												"text-right text-muted tabular-nums",
										})}
									>
										{compactFormatter.format(
											skill.installs,
										)}
									</td>
									<td
										className={tableStyles.cell({
											className:
												"text-muted [overflow-wrap:anywhere]",
										})}
									>
										{skill.source}
									</td>
									<td
										className={tableStyles.cell({
											className: "text-right",
										})}
									>
										<Button
											size="sm"
											variant="secondary"
											onPress={() =>
												handleInstallClick(skill)
											}
										>
											{t("install")}
										</Button>
									</td>
								</>
							)}
						/>
					</Table>
					<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-muted">
						<span>
							{t("skillsMarketCount", { count: results.length })}
						</span>
						{isError && (
							<span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
								{error.message}
							</span>
						)}
						{(hasNextPage || isError) && (
							<Button
								variant="ghost"
								size="sm"
								isPending={isFetching}
								onPress={() => {
									if (isError && !isFetchNextPageError)
										void refetch();
									else handleLoadMore();
								}}
							>
								{t(isError ? "retry" : "skillsMarketLoadMore")}
							</Button>
						)}
					</div>
				</>
			)}
			<InstallModal
				isOpen={installModalOpen}
				selectedSkill={selectedSkill}
				selectedAgents={selectedAgents}
				onSelectedAgentsChange={setSelectedAgents}
				installResults={installResults}
				phase={phase}
				skillAgents={skillAgents}
				installAll={installAll}
				onInstallAllChange={setInstallAll}
				installToProject={installToProject}
				canInstallToProject={canInstallToProject}
				onInstallToProjectChange={setInstallToProject}
				selectedProjectId={selectedProjectId}
				onSelectedProjectIdChange={setSelectedProjectId}
				projects={projects}
				skillAuditReady={skillAuditReady}
				audit={audit}
				onClose={handleCloseInstallModal}
				onInstall={handleInstall}
				onConfirmInstall={handleConfirmInstall}
			/>
		</>
	);
}
