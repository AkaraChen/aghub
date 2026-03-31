import {
	ExclamationTriangleIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import { AlertDialog, Button, Modal, Spinner, toast } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as pathe from "pathe";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import { ConfigSource } from "../lib/api-types";
import {
	formatAgentName,
	type LocationGroup,
	type SkillGroup,
} from "./skill-detail-helpers";

interface DeleteSkillLocationDialogProps {
	item: LocationGroup | null;
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
	skillName: string;
}

interface DeleteSkillDialogProps {
	group: SkillGroup;
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

export function DeleteSkillLocationDialog({
	item,
	isOpen,
	onClose,
	projectPath,
	skillName,
}: DeleteSkillLocationDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();

	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!item || item.installations.length === 0) {
				return;
			}

			const scope =
				item.installations[0].source === ConfigSource.Project
					? ("project" as const)
					: ("global" as const);

			const agents = item.installations.map(
				(installation) => installation.agent,
			);

			const result = await api.skills.deleteByPath({
				source_path: item.sourcePath,
				agents,
				scope,
				project_root: scope === "project" ? projectPath : undefined,
			});

			if (!result.success) {
				throw new Error(result.error || "Failed to delete skill");
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({
				queryKey: ["project-skills"],
			});
			queryClient.invalidateQueries({
				queryKey: ["skill-locks"],
			});
			onClose();
		},
		onError: (error) => {
			console.error("Skill location delete mutation error:", error);
			toast.danger(t("failedToDeleteSkill"));
		},
	});

	const folderPath = item ? pathe.dirname(item.sourcePath) : "";
	const agentNames =
		item?.installations.length === 1
			? formatAgentName(item.installations[0].agent)
			: (item?.installations
					.map((i) => formatAgentName(i.agent))
					.join(", ") ?? "");
	const isMultiAgent = (item?.installations.length ?? 0) > 1;

	return (
		<AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<AlertDialog.Container>
				<AlertDialog.Dialog className="sm:max-w-[420px]">
					<AlertDialog.CloseTrigger />
					<AlertDialog.Header>
						<AlertDialog.Icon status="danger" />
						<AlertDialog.Heading>
							{isMultiAgent
								? t("deleteSkillTitle")
								: t("deleteSkillForAgentTitle", {
										agent: agentNames,
									})}
						</AlertDialog.Heading>
					</AlertDialog.Header>
					<AlertDialog.Body>
						<p className="text-sm text-muted">
							{isMultiAgent
								? t("deleteSkillForAgentsWarning", {
										name: skillName,
										agents: agentNames,
									})
								: t("deleteSkillForAgentWarning", {
										name: skillName,
										agent: agentNames,
									})}
						</p>
						{item && (
							<div className="mt-4 rounded-lg bg-surface-secondary px-3 py-2">
								<p className="text-[11px] text-muted">
									{isMultiAgent
										? t("sharedLocation")
										: item.installations[0].source ===
												ConfigSource.Project
											? t("project")
											: t("global")}
								</p>
								<p className="mt-1 font-mono text-xs text-foreground">
									{folderPath}
								</p>
							</div>
						)}
					</AlertDialog.Body>
					<AlertDialog.Footer>
						<Button
							slot="close"
							variant="tertiary"
							onPress={onClose}
							isDisabled={deleteMutation.isPending}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							onPress={() => deleteMutation.mutate()}
							isDisabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? (
								<>
									<Spinner size="sm" className="mr-2" />
									{t("deleting")}
								</>
							) : (
								t("delete")
							)}
						</Button>
					</AlertDialog.Footer>
				</AlertDialog.Dialog>
			</AlertDialog.Container>
		</AlertDialog.Backdrop>
	);
}

export function DeleteSkillDialog({
	group,
	isOpen,
	onClose,
	projectPath,
}: DeleteSkillDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = useMemo(() => createApi(baseUrl), [baseUrl]);
	const queryClient = useQueryClient();

	const skill = group.items[0];

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const itemsWithAgent = group.items.filter((item) => item.agent);

			const globalItems = itemsWithAgent.filter(
				(item) => item.source === ConfigSource.Global,
			);
			const projectItems = itemsWithAgent.filter(
				(item) => item.source === ConfigSource.Project,
			);

			const results = [];

			if (globalItems.length > 0) {
				const result = await api.skills.reconcile({
					source: {
						agent: globalItems[0].agent!,
						scope: "global",
						name: skill.name,
					},
					removed: globalItems.map((item) => item.agent!),
				});
				results.push(result);
			}

			if (projectItems.length > 0) {
				const result = await api.skills.reconcile({
					source: {
						agent: projectItems[0].agent!,
						scope: "project",
						project_root: projectPath,
						name: skill.name,
					},
					removed: projectItems.map((item) => item.agent!),
				});
				results.push(result);
			}

			const totalFailed = results.reduce(
				(sum, r) => sum + r.failed_count,
				0,
			);
			const totalResults = results.reduce(
				(sum, r) => sum + r.results.length,
				0,
			);

			if (totalFailed > 0) {
				throw new Error(
					`${totalFailed} of ${totalResults} deletions failed`,
				);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["skills"] });
			queryClient.invalidateQueries({
				queryKey: ["project-skills"],
			});
			onClose();
		},
	});

	const globalItems = group.items.filter(
		(item) => item.source === ConfigSource.Global,
	);
	const projectItems = group.items.filter(
		(item) => item.source === ConfigSource.Project,
	);

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Modal.Header>
						<div className="flex items-center gap-2">
							<ExclamationTriangleIcon className="size-5 text-warning" />
							<Modal.Heading>{t("deleteSkill")}</Modal.Heading>
						</div>
					</Modal.Header>

					<Modal.Body className="p-2">
						<p className="mb-4 text-sm text-muted">
							{t("deleteSkillWarning", {
								count: group.items.length,
							})}
						</p>

						<div className="space-y-4">
							{globalItems.length > 0 && (
								<div>
									<h4
										className="
											mb-2 text-xs font-medium tracking-wide text-muted
											uppercase
										"
									>
										{t("globalSkills")}
									</h4>
									<div className="space-y-2">
										{globalItems.map((item) => (
											<div
												key={item.agent}
												className="flex items-center gap-2 text-sm"
											>
												<XCircleIcon className="size-4 shrink-0 text-danger" />
												<span className="text-foreground">
													{item.agent
														? formatAgentName(
																item.agent,
															)
														: t("default")}
												</span>
												{item.source_path && (
													<span className="flex-1 truncate text-xs text-muted">
														{item.source_path}
													</span>
												)}
											</div>
										))}
									</div>
								</div>
							)}

							{projectItems.length > 0 && (
								<div>
									<h4
										className="
											mb-2 text-xs font-medium tracking-wide text-muted
											uppercase
										"
									>
										{t("projectSkills")}
									</h4>
									<div className="space-y-2">
										{projectItems.map((item) => (
											<div
												key={item.agent}
												className="flex items-center gap-2 text-sm"
											>
												<XCircleIcon className="size-4 shrink-0 text-danger" />
												<span className="text-foreground">
													{item.agent
														? formatAgentName(
																item.agent,
															)
														: t("default")}
												</span>
												{item.source_path && (
													<span className="flex-1 truncate text-xs text-muted">
														{item.source_path}
													</span>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</Modal.Body>

					<Modal.Footer>
						<Button
							slot="close"
							variant="secondary"
							onPress={onClose}
							isDisabled={deleteMutation.isPending}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							onPress={() => deleteMutation.mutate()}
							isDisabled={deleteMutation.isPending}
						>
							{deleteMutation.isPending ? (
								<>
									<Spinner size="sm" className="mr-2" />
									{t("deleting")}
								</>
							) : (
								t("deleteAll")
							)}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
