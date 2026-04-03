import {
	ChevronDownIcon,
	DocumentDuplicateIcon,
	ExclamationTriangleIcon,
	PencilIcon,
	PlusIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import {
	Accordion,
	Button,
	Card,
	Chip,
	Modal,
	Spinner,
	Tooltip,
} from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { AgentIcon } from "../lib/agent-icons";
import { sortAgentObjects } from "../lib/utils";
import type { SubAgentGroup } from "./manage-sub-agent-agents-dialog";
import { ManageSubAgentAgentsDialog } from "./manage-sub-agent-agents-dialog";
import { formatAgentName } from "./skill-detail-helpers";
import { TransferDialog } from "./transfer-dialog";

export type { SubAgentGroup };

interface SubAgentDetailProps {
	group: SubAgentGroup;
	onEdit: () => void;
	onDelete: () => void;
	isDeleting: boolean;
	projectPath?: string;
}

export function SubAgentDetail({
	group,
	onEdit,
	onDelete,
	isDeleting,
	projectPath,
}: SubAgentDetailProps) {
	const { t } = useTranslation();
	const { allAgents } = useAgentAvailability();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [transferDialogOpen, setTransferDialogOpen] = useState(false);
	const [manageDialogOpen, setManageDialogOpen] = useState(false);

	const primary = group.items[0];

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full space-y-4 p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<h2 className="truncate text-xl font-semibold text-foreground">
									{primary.name}
								</h2>
								{primary.description && (
									<p className="mt-1 text-sm text-muted">
										{primary.description}
									</p>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="min-h-[44px] min-w-[44px] text-muted"
										aria-label={t("editSubAgent")}
										onPress={onEdit}
									>
										<PencilIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("editSubAgent")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="min-h-[44px] min-w-[44px] text-muted hover:text-danger"
										aria-label={t("deleteSubAgent")}
										onPress={() =>
											setDeleteDialogOpen(true)
										}
									>
										<TrashIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("deleteSubAgent")}
									</Tooltip.Content>
								</Tooltip>
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-6">
							<div className="space-y-3">
								<h3 className="text-xs font-medium uppercase tracking-wider text-muted">
									{t("agents")}
								</h3>
								<div className="flex flex-wrap gap-2">
									{sortAgentObjects(
										group.items,
										allAgents,
									).map((item) => (
										<Chip
											key={item.agent ?? "default"}
											size="sm"
											variant="soft"
											color="default"
											className="max-w-full pr-3"
										>
											<span className="flex items-center gap-1.5 truncate">
												<AgentIcon
													id={item.agent ?? "default"}
													name={formatAgentName(
														item.agent ?? "default",
													)}
													size="sm"
													variant="ghost"
												/>
												<span className="truncate">
													{formatAgentName(
														item.agent ?? "default",
													)}
												</span>
											</span>
										</Chip>
									))}
								</div>
							</div>
						</Card.Content>

						<Card.Footer className="pt-4 border-t border-separator flex flex-wrap gap-3">
							<Button
								variant="secondary"
								onPress={() => setTransferDialogOpen(true)}
							>
								<DocumentDuplicateIcon className="size-4" />
								{t("transfer")}
							</Button>
							<Button
								variant="primary"
								onPress={() => setManageDialogOpen(true)}
							>
								<PlusIcon className="size-4" />
								{t("addToAgent")}
							</Button>
						</Card.Footer>
					</Card>

					{primary.instruction && (
						<Accordion variant="surface">
							<Accordion.Item>
								<Accordion.Heading>
									<Accordion.Trigger>
										{t("subAgentInstruction")}
										<Accordion.Indicator>
											<ChevronDownIcon className="size-4" />
										</Accordion.Indicator>
									</Accordion.Trigger>
								</Accordion.Heading>
								<Accordion.Panel>
									<Accordion.Body>
										<pre
											role="article"
											aria-label={t(
												"subAgentInstruction",
											)}
											className="overflow-x-auto rounded-md bg-surface-secondary p-3 font-mono text-xs whitespace-pre-wrap text-foreground"
										>
											{primary.instruction}
										</pre>
									</Accordion.Body>
								</Accordion.Panel>
							</Accordion.Item>
						</Accordion>
					)}
				</div>
			</div>

			<Modal.Backdrop
				isOpen={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
			>
				<Modal.Container>
					<Modal.Dialog>
						<Modal.CloseTrigger />
						<Modal.Header>
							<div className="flex items-center gap-2">
								<ExclamationTriangleIcon className="size-5 text-warning" />
								<Modal.Heading>
									{t("deleteSubAgent")}
								</Modal.Heading>
							</div>
						</Modal.Header>
						<Modal.Body>
							<p className="text-sm text-muted">
								{t("deleteSubAgentConfirm", {
									name: primary.name,
								})}
							</p>
						</Modal.Body>
						<Modal.Footer>
							<Button
								slot="close"
								variant="secondary"
								size="md"
								isDisabled={isDeleting}
								className="min-h-[44px]"
								onPress={() => setDeleteDialogOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								size="md"
								isDisabled={isDeleting}
								className="min-h-[44px] min-w-[120px]"
								onPress={() => {
									onDelete();
									setDeleteDialogOpen(false);
								}}
							>
								{isDeleting ? (
									<Spinner size="sm" />
								) : (
									t("deleteSubAgent")
								)}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>

			{primary.agent && (
				<TransferDialog
					isOpen={transferDialogOpen}
					onClose={() => setTransferDialogOpen(false)}
					resourceType="sub_agent"
					name={primary.name}
					sourceAgent={primary.agent}
					sourceScope={
						primary.source === "project" ? "project" : "global"
					}
					sourceProjectRoot={projectPath}
				/>
			)}

			<ManageSubAgentAgentsDialog
				group={group}
				isOpen={manageDialogOpen}
				onClose={() => setManageDialogOpen(false)}
				projectPath={projectPath}
			/>
		</>
	);
}
