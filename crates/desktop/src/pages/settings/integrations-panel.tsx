import { TrashIcon } from "@heroicons/react/24/outline";
import {
	AlertDialog,
	Avatar,
	Button,
	Card,
	ListBox,
	Select,
	Spinner,
	Table,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Key } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type { CodeEditorType, CredentialResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { useCurrentCodeEditor } from "../../hooks/use-integrations";
import {
	credentialsListQueryOptions,
	deleteCredentialMutationOptions,
} from "../../requests/credentials";
import { CreateCredentialDialog } from "./components/create-credential-dialog";

const iconModules = import.meta.glob<{ default: string }>(
	"../../assets/agent/*.svg",
	{ eager: true, query: "?raw" },
);

const ICON_ALIASES: Record<string, string> = {
	vs_code_insiders: "vs_code",
	fleet: "rust_rover",
};

const UNDERSCORE_REGEX = /_/g;

function EditorIcon({ id, name }: { id: string; name: string }) {
	const resolvedId = ICON_ALIASES[id] ?? id;
	const path =
		iconModules[`../../assets/agent/${resolvedId}.svg`] ??
		iconModules[
			`../../assets/agent/${resolvedId.replace(UNDERSCORE_REGEX, "")}.svg`
		];
	const svg = path;

	if (svg) {
		return (
			<div
				className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-4"
				// eslint-disable-next-line react-dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{
					__html: (svg.default || svg) as string,
				}}
			/>
		);
	}

	return (
		<Avatar size="sm" variant="soft" className="size-5">
			<Avatar.Fallback className="text-[10px]">
				{name.charAt(0).toUpperCase()}
			</Avatar.Fallback>
		</Avatar>
	);
}

export default function IntegrationsPanel() {
	const { t } = useTranslation();
	const { codeEditors, isLoading, selectedEditor, setCurrentEditor } =
		useCurrentCodeEditor();

	const api = useApi();
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<CredentialResponse | null>(
		null,
	);

	const { data: credentials = [], isLoading: isCredentialsLoading } =
		useQuery({
			...credentialsListQueryOptions({ api }),
		});

	const deleteMutation = useMutation({
		...deleteCredentialMutationOptions({
			api,
			queryClient,
			onSuccess: async () => {
				toast.success(t("credentialDeleted"));
				setDeleteTarget(null);
			},
		}),
		onSuccess: () => {},
		onError: (error) => {
			console.error("Failed to delete credential:", error);
			toast.danger(t("credentialDeleteFailed"));
		},
	});

	const handleEditorChange = async (value: Key | null) => {
		if (!value) return;
		const editor = value as CodeEditorType;
		await setCurrentEditor(editor || undefined);
	};

	if (isLoading) {
		return (
			<div className="flex h-32 items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	const installedEditors = codeEditors?.filter((e) => e.installed) || [];

	return (
		<div className="space-y-4">
			<Card className="p-4">
				<Card.Content className="space-y-4">
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<span className="text-sm font-medium text-(--foreground)">
								{t("codeEditors")}
							</span>
							<span className="block text-xs text-muted">
								{t("codeEditorsDescription")}
							</span>
						</div>
						<Select
							variant="secondary"
							selectedKey={selectedEditor || null}
							onSelectionChange={handleEditorChange}
							aria-label={t("codeEditors")}
							className="min-w-56"
						>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{installedEditors.map((editor) => (
										<ListBox.Item
											key={editor.id}
											id={editor.id}
											textValue={editor.name}
										>
											<div className="flex items-center gap-2">
												<EditorIcon
													id={editor.id}
													name={editor.name}
												/>
												{editor.name}
											</div>
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					</div>
				</Card.Content>
			</Card>

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
										!isCredentialsLoading && (
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
				onSuccess={(_newId) => {
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
