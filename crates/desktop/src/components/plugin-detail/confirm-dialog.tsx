"use client";

import { AlertDialog, Button, Spinner } from "@heroui/react";

interface PluginConfirmDialogProps {
	isOpen: boolean;
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	status: "danger" | "warning";
	isPending?: boolean;
	isConfirmDisabled?: boolean;
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
	isPending = false,
	isConfirmDisabled = false,
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
							isDisabled={isPending}
						>
							{cancelLabel}
						</Button>
						<Button
							variant={
								status === "danger" ? "primary" : undefined
							}
							onPress={onConfirm}
							isDisabled={isPending || isConfirmDisabled}
						>
							{isPending ? (
								<Spinner size="sm" color="current" />
							) : (
								confirmLabel
							)}
						</Button>
					</AlertDialog.Footer>
				</AlertDialog.Dialog>
			</AlertDialog.Container>
		</AlertDialog.Backdrop>
	);
}
