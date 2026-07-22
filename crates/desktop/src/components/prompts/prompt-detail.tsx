import {
	DocumentDuplicateIcon,
	PencilIcon,
	TrashIcon,
} from "@heroicons/react/24/solid";
import { AlertDialog, Button, Card, Chip, Tooltip, toast } from "@heroui/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PromptResponse } from "../../generated/dto";

interface PromptDetailProps {
	prompt: PromptResponse;
	onEdit: () => void;
	onDelete: () => void;
	isDeleting: boolean;
}

export function PromptDetail({
	prompt,
	onEdit,
	onDelete,
	isDeleting,
}: PromptDetailProps) {
	const { t } = useTranslation();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	const handleCopy = async () => {
		try {
			await writeText(prompt.content);
			toast.success(t("promptContentCopied"));
		} catch (error) {
			console.error("Failed to copy prompt content:", error);
			toast.danger(t("promptContentCopyError"));
		}
	};

	return (
		<>
			<div className="h-full overflow-y-auto">
				<div className="w-full p-4 sm:p-6">
					<Card>
						<Card.Header className="flex flex-row items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<Card.Title
									render={(props) => <h2 {...props} />}
									className="truncate text-xl"
								>
									{prompt.title}
								</Card.Title>
								{prompt.description && (
									<Card.Description className="mt-1">
										{prompt.description}
									</Card.Description>
								)}
							</div>
							<div className="flex items-center gap-1">
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted"
										aria-label={t("copy")}
										onPress={() => void handleCopy()}
									>
										<DocumentDuplicateIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("copy")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted"
										aria-label={t("editPrompt")}
										onPress={onEdit}
									>
										<PencilIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("editPrompt")}
									</Tooltip.Content>
								</Tooltip>
								<Tooltip delay={0}>
									<Button
										isIconOnly
										variant="ghost"
										size="md"
										className="text-muted hover:text-danger"
										aria-label={t("deletePrompt")}
										onPress={() =>
											setDeleteDialogOpen(true)
										}
									>
										<TrashIcon className="size-4" />
									</Button>
									<Tooltip.Content>
										{t("deletePrompt")}
									</Tooltip.Content>
								</Tooltip>
							</div>
						</Card.Header>

						<Card.Content className="flex flex-col gap-6">
							{prompt.tags.length > 0 && (
								<section className="space-y-3">
									<h3 className="text-sm font-medium text-foreground">
										{t("promptTags")}
									</h3>
									<div className="flex flex-wrap gap-2">
										{prompt.tags.map((tag) => (
											<Chip
												key={tag}
												size="sm"
												variant="soft"
												color="default"
											>
												{tag}
											</Chip>
										))}
									</div>
								</section>
							)}

							<section className="space-y-3">
								<h3 className="text-sm font-medium text-foreground">
									{t("promptContent")}
								</h3>
								<pre className="overflow-x-auto rounded-md bg-surface-secondary p-3 font-sans text-sm leading-6 whitespace-pre-wrap text-foreground">
									{prompt.content}
								</pre>
							</section>

							{prompt.variables.length > 0 && (
								<section className="space-y-3">
									<h3 className="text-sm font-medium text-foreground">
										{t("promptVariables")}
									</h3>
									<div className="flex flex-wrap gap-2">
										{prompt.variables.map((variable) => (
											<Chip
												key={variable}
												size="sm"
												variant="soft"
												color="accent"
											>
												{variable}
											</Chip>
										))}
									</div>
									<p className="text-xs text-muted">
										{t("promptVariablesHint")}
									</p>
								</section>
							)}
						</Card.Content>
					</Card>
				</div>
			</div>

			<AlertDialog.Backdrop
				isOpen={deleteDialogOpen}
				isDismissable={!isDeleting}
				isKeyboardDismissDisabled={isDeleting}
				onOpenChange={(isOpen) => {
					if (!isDeleting) setDeleteDialogOpen(isOpen);
				}}
			>
				<AlertDialog.Container>
					<AlertDialog.Dialog>
						<AlertDialog.Header>
							<AlertDialog.Icon status="danger">
								<TrashIcon className="size-5" />
							</AlertDialog.Icon>
							<AlertDialog.Heading>
								{t("deletePrompt")}
							</AlertDialog.Heading>
						</AlertDialog.Header>
						<AlertDialog.Body>
							<p className="text-sm text-muted">
								{t("deletePromptConfirm", {
									title: prompt.title,
								})}
							</p>
						</AlertDialog.Body>
						<AlertDialog.Footer>
							<Button
								variant="secondary"
								size="md"
								isDisabled={isDeleting}
								onPress={() => setDeleteDialogOpen(false)}
							>
								{t("cancel")}
							</Button>
							<Button
								variant="danger"
								size="md"
								isPending={isDeleting}
								className="min-w-30"
								onPress={onDelete}
							>
								{t("deletePrompt")}
							</Button>
						</AlertDialog.Footer>
					</AlertDialog.Dialog>
				</AlertDialog.Container>
			</AlertDialog.Backdrop>
		</>
	);
}
