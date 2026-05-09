"use client";

import { Button, Modal } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginMarketContent } from "./plugin-market-content";

interface PluginMarketDialogProps {
	isOpen: boolean;
	onClose: () => void;
	installScope?: "global" | "project" | "local";
}

export function PluginMarketDialog({
	isOpen,
	onClose,
	installScope = "global",
}: PluginMarketDialogProps) {
	const { t } = useTranslation();
	// Bumping this on close-request-then-open lets us reset the inline filters
	// (search query / category) by re-mounting <PluginMarketContent>.
	const [contentKey, setContentKey] = useState(0);

	const handleClose = () => {
		setContentKey((value) => value + 1);
		onClose();
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
			<Modal.Container>
				<Modal.Dialog className="max-h-[80vh] w-[calc(100vw-2rem)] max-w-5xl overflow-hidden">
					<Modal.CloseTrigger />
					<Modal.Body className="flex min-h-0 flex-col gap-2.5 overflow-hidden px-4 pb-2.5 pt-3.5">
						<PluginMarketContent
							key={contentKey}
							installScope={installScope}
							enabled={isOpen}
							variant="modal"
							footerSlot={
								<Button
									variant="secondary"
									size="sm"
									onPress={handleClose}
								>
									{t("menu.close")}
								</Button>
							}
						/>
					</Modal.Body>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
