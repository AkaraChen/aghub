import {
	AlertDialog,
	Button,
	Input,
	Label,
	Modal,
	TextField,
	toast,
} from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ResourceGroup } from "../lib/store";

interface GroupNameDialogProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	initialName?: string;
	onSubmit: (name: string) => Promise<void>;
}

export function GroupNameDialog({
	isOpen,
	onClose,
	title,
	initialName = "",
	onSubmit,
}: GroupNameDialogProps) {
	const { t } = useTranslation();
	const [name, setName] = useState(initialName);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Reset the field whenever the dialog opens for a new target.
	const [wasOpen, setWasOpen] = useState(isOpen);
	if (isOpen !== wasOpen) {
		setWasOpen(isOpen);
		if (isOpen) setName(initialName);
	}

	const trimmed = name.trim();

	const handleSubmit = async () => {
		if (!trimmed || isSubmitting) return;
		setIsSubmitting(true);
		try {
			await onSubmit(trimmed);
			onClose();
		} catch (error) {
			toast.danger(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog className="sm:max-w-[360px]">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{title}</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="p-2">
						<TextField
							className="w-full"
							variant="secondary"
							isRequired
							validationBehavior="aria"
						>
							<Label>{t("groupName")}</Label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={t("groupNamePlaceholder")}
								variant="secondary"
								onKeyDown={(e) => {
									// keyCode 229 covers WKWebView, where
									// the IME-confirm keydown reports
									// isComposing as false.
									if (
										e.key === "Enter" &&
										!e.nativeEvent.isComposing &&
										e.keyCode !== 229
									) {
										e.preventDefault();
										void handleSubmit();
									}
								}}
							/>
						</TextField>
					</Modal.Body>
					<Modal.Footer>
						<Button
							slot="close"
							variant="secondary"
							onPress={onClose}
							isDisabled={isSubmitting}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="primary"
							onPress={() => void handleSubmit()}
							isDisabled={!trimmed || isSubmitting}
						>
							{t("save")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}

interface DeleteGroupDialogProps {
	group: ResourceGroup | null;
	isOpen: boolean;
	onClose: () => void;
	onConfirm: () => Promise<void>;
}

export function DeleteGroupDialog({
	group,
	isOpen,
	onClose,
	onConfirm,
}: DeleteGroupDialogProps) {
	const { t } = useTranslation();
	const [isDeleting, setIsDeleting] = useState(false);

	const handleConfirm = async () => {
		if (isDeleting) return;
		setIsDeleting(true);
		try {
			await onConfirm();
			onClose();
		} catch (error) {
			toast.danger(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<AlertDialog.Container>
				<AlertDialog.Dialog className="sm:max-w-[420px]">
					<AlertDialog.CloseTrigger />
					<AlertDialog.Header>
						<AlertDialog.Icon status="danger" />
						<AlertDialog.Heading>
							{t("deleteGroup")}
						</AlertDialog.Heading>
					</AlertDialog.Header>
					<AlertDialog.Body>
						<p className="text-sm text-muted">
							{t("deleteGroupWarning", {
								name: group?.name ?? "",
							})}
						</p>
					</AlertDialog.Body>
					<AlertDialog.Footer>
						<Button
							slot="close"
							variant="tertiary"
							onPress={onClose}
							isDisabled={isDeleting}
						>
							{t("cancel")}
						</Button>
						<Button
							variant="danger"
							onPress={() => void handleConfirm()}
							isDisabled={isDeleting}
						>
							{t("delete")}
						</Button>
					</AlertDialog.Footer>
				</AlertDialog.Dialog>
			</AlertDialog.Container>
		</AlertDialog.Backdrop>
	);
}
