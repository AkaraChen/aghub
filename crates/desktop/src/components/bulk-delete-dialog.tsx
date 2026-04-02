import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import { Button, Modal, Spinner } from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ConfigSource } from "../generated/dto/ConfigSource";
import { useApi } from "../hooks/use-api";
import { invalidateMcpQueries } from "../requests/mcps";
import { invalidateSkillQueries } from "../requests/skills";

interface BulkDeleteItem {
	name: string;
	agent?: string | null;
	source?: ConfigSource | null;
}

interface BulkDeleteGroup {
	key: string;
	items: BulkDeleteItem[];
	resourceType?: "mcp" | "skill";
}

interface BulkDeleteDialogProps {
	groups: BulkDeleteGroup[];
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
	resourceType: "mcp" | "skill" | "mixed";
	projectPath?: string;
}

export function BulkDeleteDialog({
	groups,
	isOpen,
	onClose,
	onSuccess,
	resourceType,
	projectPath,
}: BulkDeleteDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const promises: Promise<void>[] = [];
			const deleteInfo: Array<{
				name: string;
				agent: string;
				scope: string;
			}> = [];
			for (const group of groups) {
				const groupResourceType = group.resourceType ?? resourceType;
				for (const item of group.items) {
					if (!item.agent) continue;
					const scope =
						item.source === "project" ? "project" : "global";
					const typedScope = scope as "global" | "project";
					const projectRoot =
						typedScope === "project" ? projectPath : undefined;
					if (groupResourceType === "mcp") {
						promises.push(
							api.mcps.delete(
								item.name,
								item.agent,
								typedScope,
								projectRoot,
							),
						);
					} else {
						promises.push(
							api.skills.delete(
								item.agent,
								group.key,
								typedScope,
								projectRoot,
							),
						);
					}
					deleteInfo.push({
						name: item.name,
						agent: item.agent,
						scope,
					});
				}
			}
			const results = await Promise.allSettled(promises);
			const failures = results
				.map((r, i) => ({ result: r, info: deleteInfo[i] }))
				.filter(({ result }) => result.status === "rejected")
				.map(({ result, info }) => ({
					...info,
					reason: (result as PromiseRejectedResult).reason,
				}));
			if (failures.length > 0) {
				console.error(
					`${resourceType} bulk delete failures:`,
					failures,
				);
				throw new Error(
					`${failures.length} of ${promises.length} deletions failed`,
				);
			}
			return { deleted: promises.length };
		},
		onSuccess: () => {
			if (resourceType === "mcp" || resourceType === "mixed") {
				void invalidateMcpQueries(queryClient);
			}
			if (resourceType === "skill" || resourceType === "mixed") {
				void invalidateSkillQueries(queryClient);
			}
		},
		onError: (error) => {
			console.error("Bulk delete mutation error:", error);
		},
		onSettled: () => {
			onClose();
			onSuccess();
		},
	});

	const confirmKey =
		resourceType === "mcp"
			? "bulkDeleteMcpConfirm"
			: resourceType === "skill"
				? "bulkDeleteSkillConfirm"
				: "bulkDeleteMixedConfirm";

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Modal.Header>
						<div className="flex items-center gap-2">
							<ExclamationTriangleIcon className="size-5 text-warning" />
							<Modal.Heading>
								{t("bulkDeleteConfirmTitle")}
							</Modal.Heading>
						</div>
					</Modal.Header>
					<Modal.Body>
						<p className="text-sm text-muted">
							{t(confirmKey, {
								count: groups.length,
							})}
						</p>
					</Modal.Body>
					<Modal.Footer>
						<Button
							slot="close"
							variant="secondary"
							size="md"
							onPress={onClose}
							isDisabled={deleteMutation.isPending}
							className="min-h-[44px]"
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							size="md"
							onPress={() => deleteMutation.mutate()}
							isDisabled={deleteMutation.isPending}
							className="min-h-[44px] min-w-[120px]"
						>
							{deleteMutation.isPending ? (
								<Spinner size="sm" />
							) : (
								t("deleteSelected")
							)}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
