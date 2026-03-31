import { TrashIcon } from "@heroicons/react/24/outline";
import {
	AlertDialog,
	Button,
	Card,
	CardContent,
	CardHeader,
	Table,
	TableBody,
	TableCell,
	TableColumn,
	TableHeader,
	TableRow,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitHubCredential } from "../../lib/secrets";
import { removeCredential } from "../../lib/secrets";
import { CreateCredentialDialog } from "./components/create-credential-dialog";

// TODO: 实现从 SecretStore 读取凭证的 API
async function getCredentials(_password: string): Promise<GitHubCredential[]> {
	// 临时返回空数组，等待后端 API 实现
	return [];
}

export default function CredentialsPanel() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<GitHubCredential | null>(
		null,
	);

	// TODO: 从用户获取或使用默认密码
	const password = "default-password";

	const { data: credentials = [], isLoading } = useQuery({
		queryKey: ["credentials"],
		queryFn: () => getCredentials(password),
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await removeCredential(password, id);
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

	const columns = useMemo(
		() => [
			{ key: "name", label: t("credentialName") },
			{ key: "type", label: t("credentialType") },
			{ key: "email", label: t("credentialEmail") },
			{ key: "actions", label: "" },
		],
		[t],
	);

	const handleDelete = () => {
		if (deleteTarget) {
			deleteMutation.mutate(deleteTarget.id);
		}
	};

	return (
		<div className="space-y-4">
			<Card variant="secondary">
				<CardHeader className="flex items-center justify-between">
					<div>
						<h3 className="text-lg font-semibold">
							{t("credentials")}
						</h3>
						<p className="text-sm text-muted">
							{t("credentialsDescription")}
						</p>
					</div>
					<Button onPress={() => setIsCreateOpen(true)}>
						{t("createCredential")}
					</Button>
				</CardHeader>
				<CardContent>
					<Table aria-label={t("credentials")}>
						<TableHeader columns={columns}>
							{(column) => (
								<TableColumn key={column.key}>
									{column.label}
								</TableColumn>
							)}
						</TableHeader>
						<TableBody items={credentials}>
							{(credential) => (
								<TableRow key={credential.id}>
									<TableCell>{credential.name}</TableCell>
									<TableCell>
										{t("githubCredential")}
									</TableCell>
									<TableCell>{credential.email}</TableCell>
									<TableCell>
										<Button
											isIconOnly
											variant="tertiary"
											size="sm"
											onPress={() =>
												setDeleteTarget(credential)
											}
										>
											<TrashIcon className="size-4" />
										</Button>
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
					{credentials.length === 0 && !isLoading && (
						<div className="py-8 text-center text-muted">
							{t("noCredentials")}
						</div>
					)}
				</CardContent>
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
								onPress={handleDelete}
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
