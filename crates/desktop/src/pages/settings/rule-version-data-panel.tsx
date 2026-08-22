import { AlertDialog, Button, Card, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import {
	clearRuleVersionsMutationOptions,
	ruleVersionStorageQueryOptions,
} from "../../requests/rules";

export default function RuleVersionDataPanel() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const storageQuery = useQuery(ruleVersionStorageQueryOptions({ api }));
	const clearMutation = useMutation({
		...clearRuleVersionsMutationOptions({ api, queryClient }),
		onSuccess: () => {
			setIsConfirmOpen(false);
			toast.success(t("ruleVersionsCleared"));
		},
		onError: (error) => {
			console.error("Failed to clear rule version history:", error);
			toast.danger(t("ruleVersionsClearFailed"));
		},
	});

	return (
		<>
			<div
				data-testid="rule-version-data-panel"
				className="mx-auto max-w-4xl"
			>
				<Card className="p-0">
					<Card.Content className="space-y-5 p-4">
						<div className="space-y-0.5">
							<h3 className="text-sm font-medium text-foreground">
								{t("ruleVersionHistory")}
							</h3>
							<p className="text-xs text-muted">
								{t("ruleVersionHistoryDescription")}
							</p>
						</div>

						<div className="space-y-4 border-t border-separator pt-4">
							<section
								aria-labelledby="rule-version-storage-heading"
								className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
							>
								<h4
									id="rule-version-storage-heading"
									className="shrink-0 text-sm font-medium text-foreground"
								>
									{t("ruleVersionStorageLocation")}
								</h4>
								<p className="min-w-0 break-all font-mono text-xs text-muted sm:max-w-[75%] sm:text-right">
									{storageQuery.isPending
										? t("loading")
										: storageQuery.isError
											? t("ruleVersionDataUnavailable")
											: storageQuery.data.file_path}
								</p>
							</section>

							<section
								aria-labelledby="rule-version-retention-heading"
								className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
							>
								<h4
									id="rule-version-retention-heading"
									className="shrink-0 text-sm font-medium text-foreground"
								>
									{t("ruleVersionRetention")}
								</h4>
								<p className="text-xs text-muted">
									{storageQuery.isPending
										? t("loading")
										: storageQuery.isError
											? t("ruleVersionDataUnavailable")
											: t("ruleVersionRetentionValue", {
													count: storageQuery.data
														.max_versions_per_file,
												})}
								</p>
							</section>

							<section className="flex flex-col gap-3 border-t border-separator pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
								<div className="min-w-0 space-y-0.5">
									<h4 className="text-sm font-medium text-foreground">
										{t("clearRuleVersions")}
									</h4>
									<p className="text-xs text-muted">
										{t("clearRuleVersionsDescription")}
									</p>
								</div>
								<Button
									variant="danger"
									size="sm"
									className="shrink-0"
									onPress={() => setIsConfirmOpen(true)}
								>
									{t("clearRuleVersions")}
								</Button>
							</section>
						</div>
					</Card.Content>
				</Card>
			</div>

			<AlertDialog.Backdrop
				isOpen={isConfirmOpen}
				onOpenChange={setIsConfirmOpen}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("clearRuleVersionsConfirmTitle")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<p className="text-sm text-muted">
								{t("clearRuleVersionsConfirmDescription")}
							</p>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								isDisabled={clearMutation.isPending}
								onPress={() => setIsConfirmOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isPending={clearMutation.isPending}
								onPress={() => clearMutation.mutate()}
							>
								{t("clearRuleVersionsConfirmAction")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}
