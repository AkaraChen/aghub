import { TrashIcon } from "@heroicons/react/24/outline";
import { AlertDialog, Button, Card, Table, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitHubCredential } from "../../lib/secrets";
import { getCredentials, removeCredential } from "../../lib/secrets";
import { CreateCredentialDialog } from "./components/create-credential-dialog";

export default function CredentialsPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<GitHubCredential | null>(
		null,
	);

	const { data: credentials = [], isLoading } = useQuery({
		queryKey: ["credentials"],
		queryFn: () => getCredentials(""),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await removeCredential("", id);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["credentials"] });
			toast.success(t("credentialDeleted"));
			setDeleteTarget(null);
		},
		onError: (error) => {
			console.error("Failed to delete credential:", error);
			toast.danger(t("credentialDeleteFailed"));
		},
	});

	return (
		<div className="space-y-4">
			<Card className="p-0">
				<Card.Header className="flex flex-row items-start justify-between p-4">
					<div>
						<Card.Title>{t("credentials")}</Card.Title>
						<Card.Description>
							{t("credentialsDescription")}
						</Card.Description>
					</div>
					<Button onPress={() => setIsCreateOpen(true)}>
						{t("createCredential")}
					</Button>
				</Card.Header>
				<Card.Content className="p-4 pt-0">
					<Table>
						<Table.ScrollContainer>
							<Table.Content aria-label={t("credentials")}>
								<Table.Header>
									<Table.Column isRowHeader>
										{t("credentialName")}
									</Table.Column>
									<Table.Column>
										{t("credentialType")}
									</Table.Column>
									<Table.Column>{""}</Table.Column>
								</Table.Header>
								<Table.Body
									items={credentials}
									renderEmptyState={() =>
										!isLoading && (
											<div className="py-8 text-center text-sm text-muted">
												{t("noCredentials")}
											</div>
										)
									}
								>
									{(credential) => (
										<Table.Row id={credential.id}>
											<Table.Cell>
												{credential.name}
											</Table.Cell>
											<Table.Cell>
												{t("githubCredential")}
											</Table.Cell>
											<Table.Cell>
												<Button
													isIconOnly
													variant="tertiary"
													size="sm"
													onPress={() =>
														setDeleteTarget(
															credential,
														)
													}
												>
													<TrashIcon className="size-4" />
												</Button>
											</Table.Cell>
										</Table.Row>
									)}
								</Table.Body>
							</Table.Content>
						</Table.ScrollContainer>
					</Table>
				</Card.Content>
			</Card>

			<CreateCredentialDialog
				isOpen={isCreateOpen}
				onClose={() => setIsCreateOpen(false)}
				onSuccess={() => {
					queryClient.invalidateQueries({
						queryKey: ["credentials"],
					});
					toast.success(t("credentialCreated"));
				}}
			/>

			<AlertDialog.Backdrop
				isOpen={Boolean(deleteTarget)}
				onOpenChange={() => setDeleteTarget(null)}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog className="sm:max-w-[420px]">
						<AlertDialog.CloseTrigger />
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger" />
							<AlertDialog.Heading>
								{t("deleteCredential")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							{t("deleteCredentialConfirm")}
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="tertiary"
								onPress={() => setDeleteTarget(null)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								isDisabled={deleteMutation.isPending}
								onPress={() => {
									if (deleteTarget)
										deleteMutation.mutate(deleteTarget.id);
								}}
							>
								{deleteMutation.isPending
									? t("deleting")
									: t("delete")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</div>
	);
}
