"use client";

import { AlertDialog, Button } from "@heroui/react";

interface PluginConfirmDialogProps {
	isOpen: boolean;
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	status: "danger" | "warning";
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}

export function PluginConfirmDialog({
	isOpen,
	title,
	description,
	confirmLabel,
	cancelLabel,
	status,
	onOpenChange,
	onConfirm,
}: PluginConfirmDialogProps) {
	return (
		<AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
			<AlertDialog.Container>
				<AlertDialog.Dialog className="sm:max-w-[420px]">
					<AlertDialog.Header>
						<AlertDialog.Icon status={status} />
						<AlertDialog.Heading>{title}</AlertDialog.Heading>
					</AlertDialog.Header>
					<AlertDialog.Body>
						<p className="text-sm text-muted">{description}</p>
					</AlertDialog.Body>
					<AlertDialog.Footer>
						<Button
							variant="tertiary"
							onPress={() => onOpenChange(false)}
						>
							{cancelLabel}
						</Button>
						<Button
							variant={
								status === "danger" ? "primary" : undefined
							}
							onPress={onConfirm}
						>
							{confirmLabel}
						</Button>
					</AlertDialog.Footer>
				</AlertDialog.Dialog>
			</AlertDialog.Container>
		</AlertDialog.Backdrop>
	);
}
