import {
	ExclamationTriangleIcon,
	XCircleIcon,
} from "@heroicons/react/24/solid";
import { AlertDialog, Button, Modal, Spinner } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as pathe from "pathe";
import { useMemo, useState } from "react";
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
	const [selectedInstallationId, setSelectedInstallationId] = useState<
		string | null
	>(() => item?.installations[0]?.id ?? null);

	const selectedInstallation = useMemo(() => {
		if (!item) {
			return null;
		}

		return (
			item.installations.find(
				(installation) => installation.id === selectedInstallationId,
			) ??
			item.installations[0] ??
			null
		);
	}, [item, selectedInstallationId]);

	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!selectedInstallation) {
				return;
			}

			const scope =
				selectedInstallation.source === ConfigSource.Project
					? ("project" as const)
					: ("global" as const);
			const projectRoot = scope === "project" ? projectPath : undefined;

			await api.skills.delete(
				selectedInstallation.agent,
				skillName,
				scope,
				projectRoot,
			);
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
		},
	});

	const folderPath = item ? pathe.dirname(item.sourcePath) : "";
	const scopeLabel =
		selectedInstallation?.source === ConfigSource.Project
			? t("project")
			: t("global");
	const agentName = selectedInstallation
		? formatAgentName(selectedInstallation.agent)
		: "";

	return (
		<AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<AlertDialog.Container>
				<AlertDialog.Dialog className="sm:max-w-[420px]">
					<AlertDialog.CloseTrigger />
					<AlertDialog.Header>
						<AlertDialog.Icon status="danger" />
						<AlertDialog.Heading>
							{t("deleteSkillForAgentTitle", {
								agent: agentName,
							})}
						</AlertDialog.Heading>
					</AlertDialog.Header>
					<AlertDialog.Body>
						{(item?.installations.length ?? 0) > 1 && (
							<div className="mb-4 space-y-2">
								<p className="text-sm text-muted">
									{t("deleteSharedLocationWarning")}
								</p>
								<div>
									<p
										className="
											mb-2 text-xs font-medium tracking-wide text-muted
											uppercase
										"
									>
										{t("selectAgentToDelete")}
									</p>
									<div className="flex flex-wrap gap-2">
										{item?.installations.map(
											(installation) => (
												<Button
													key={installation.id}
													size="sm"
													variant={
														installation.id ===
														selectedInstallation?.id
															? "secondary"
															: "ghost"
													}
													onPress={() =>
														setSelectedInstallationId(
															installation.id,
														)
													}
												>
													{formatAgentName(
														installation.agent,
													)}
													<span className="text-xs text-muted">
														{" · "}
														{installation.source ===
														ConfigSource.Project
															? t("project")
															: t("global")}
													</span>
												</Button>
											),
										)}
									</div>
								</div>
							</div>
						)}
						<p className="text-sm text-muted">
							{t("deleteSkillForAgentWarning", {
								name: skillName,
								agent: agentName,
							})}
						</p>
						{item && (
							<div className="mt-4 rounded-lg bg-surface-secondary px-3 py-2">
								<p className="text-[11px] text-muted">
									{scopeLabel}
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
							isDisabled={
								deleteMutation.isPending ||
								selectedInstallation === null
							}
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
			const deletions = group.items
				.filter((item) => item.agent)
				.map((item) => ({
					agent: item.agent!,
					scope:
						item.source === ConfigSource.Project
							? ("project" as const)
							: ("global" as const),
				}));
			const results = await Promise.allSettled(
				deletions.map(({ agent, scope }) =>
					api.skills.delete(agent, skill.name, scope, projectPath),
				),
			);
			const failures = results
				.map((result, index) => ({
					result,
					deletion: deletions[index],
				}))
				.filter(({ result }) => result.status === "rejected");
			if (failures.length > 0) {
				console.error("Skill delete failures:", failures);
				throw new Error(
					`${failures.length} of ${deletions.length} deletions failed`,
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
