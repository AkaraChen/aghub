import { ArrowPathIcon, TrashIcon } from "@heroicons/react/24/solid";
import { Button, Table, toast } from "@heroui/react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type {
	CCMarketplaceEntryResponse,
	CCMarketplaceSourceResponse,
} from "../../generated/dto";
import { cn } from "../../lib/utils";

interface MarketplaceSourcesTableProps {
	marketplaces: CCMarketplaceEntryResponse[];
	isPending: boolean;
	removingName?: string;
	updatingName?: string;
	onRemove: (name: string) => void;
	onUpdate: (name: string) => void;
}

export function MarketplaceSourcesTable({
	marketplaces,
	isPending,
	removingName,
	updatingName,
	onRemove,
	onUpdate,
}: MarketplaceSourcesTableProps) {
	const { t } = useTranslation();
	return (
		<Table variant="secondary">
			<Table.ScrollContainer>
				<Table.Content
					aria-label={t("marketplaceSources")}
					className="table-fixed"
				>
					<Table.Header>
						<Table.Column isRowHeader>{t("name")}</Table.Column>
						<Table.Column>{t("source")}</Table.Column>
						<Table.Column className="w-28 text-right">
							{t("actions")}
						</Table.Column>
					</Table.Header>
					<Table.Body items={marketplaces}>
						{(entry) => (
							<Table.Row id={entry.name}>
								<Table.Cell className="align-top [overflow-wrap:anywhere]">
									<p className="font-medium">{entry.name}</p>
									<p className="mt-1 font-mono text-xs text-muted">
										{entry.install_location}
									</p>
								</Table.Cell>
								<Table.Cell className="align-top">
									<SourceLink source={entry.source} />
								</Table.Cell>
								<Table.Cell className="align-top">
									<div className="flex justify-end gap-1">
										<Button
											isIconOnly
											variant="ghost"
											size="sm"
											aria-label={t(
												"marketplaceRefreshSource",
												{ name: entry.name },
											)}
											isPending={
												updatingName === entry.name
											}
											isDisabled={isPending}
											onPress={() => onUpdate(entry.name)}
										>
											{({ isPending }) => (
												<ArrowPathIcon
													className={cn(
														"size-4",
														isPending &&
															"motion-safe:animate-spin",
													)}
												/>
											)}
										</Button>
										{entry.name !==
											"claude-plugins-official" && (
											<Button
												isIconOnly
												variant="ghost"
												size="sm"
												className="text-danger"
												aria-label={t(
													"marketplaceRemoveSource",
													{ name: entry.name },
												)}
												isPending={
													removingName === entry.name
												}
												isDisabled={isPending}
												onPress={() =>
													onRemove(entry.name)
												}
											>
												<TrashIcon className="size-4" />
											</Button>
										)}
									</div>
								</Table.Cell>
							</Table.Row>
						)}
					</Table.Body>
				</Table.Content>
			</Table.ScrollContainer>
		</Table>
	);
}

function SourceLink({ source }: { source: CCMarketplaceSourceResponse }) {
	const { t } = useTranslation();
	const label =
		source.kind === "github"
			? source.repo
			: source.kind === "local"
				? source.path
				: source.url;
	const handleOpen = async () => {
		try {
			if (source.kind === "local") await revealItemInDir(source.path);
			else
				await openUrl(
					source.kind === "github"
						? `https://github.com/${source.repo}`
						: source.url,
				);
		} catch (error) {
			toast.danger(
				error instanceof Error ? error.message : t("unknownError"),
			);
		}
	};
	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-auto min-w-0 max-w-full justify-start p-0 text-left font-normal whitespace-normal text-muted [overflow-wrap:anywhere]"
			onPress={handleOpen}
		>
			{label}
		</Button>
	);
}
