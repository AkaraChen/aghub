import {
	Button,
	FieldError,
	Fieldset,
	Form,
	Input,
	Label,
	Link,
	Modal,
	TextField,
} from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { saveCredential } from "../../../lib/secrets";

const GITHUB_TOKEN_URL =
	"https://github.com/settings/tokens/new?scopes=repo,read:org&description=aghub";

interface CreateCredentialDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
}

export function CreateCredentialDialog({
	isOpen,
	onClose,
	onSuccess,
}: CreateCredentialDialogProps) {
	const { t } = useTranslation();
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const data = Object.fromEntries(new FormData(e.currentTarget)) as {
			name: string;
			token: string;
		};
		setIsSubmitting(true);
		try {
			await saveCredential("", {
				name: data.name.trim(),
				token: data.token.trim(),
			});
			onSuccess();
			onClose();
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Form validationBehavior="aria" onSubmit={handleSubmit}>
						<Modal.Header>
							<Modal.Heading>
								{t("createCredential")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="p-2">
							<Fieldset>
								<TextField
									name="name"
									className="w-full"
									variant="secondary"
									isRequired
									validate={(v) =>
										v.trim()
											? null
											: t(
													"validationCredentialNameRequired",
												)
									}
								>
									<Label>{t("credentialName")}</Label>
									<Input
										placeholder={t(
											"credentialNamePlaceholder",
										)}
										variant="secondary"
									/>
									<FieldError />
								</TextField>

								<TextField
									name="token"
									className="w-full"
									variant="secondary"
									isRequired
									type="password"
									validate={(v) =>
										v.trim()
											? null
											: t(
													"validationCredentialTokenRequired",
												)
									}
								>
									<div className="flex items-center justify-between">
										<Label>{t("credentialToken")}</Label>
										<Link
											className="text-xs"
											onPress={() =>
												openUrl(GITHUB_TOKEN_URL)
											}
										>
											{t("credentialTokenGenerate")}
										</Link>
									</div>
									<Input
										placeholder={t(
											"credentialTokenPlaceholder",
										)}
										variant="secondary"
									/>
									<FieldError />
								</TextField>
							</Fieldset>
						</Modal.Body>
						<Modal.Footer>
							<Button
								type="button"
								slot="close"
								variant="secondary"
							>
								{t("cancel")}
							</Button>
							<Button type="submit" isDisabled={isSubmitting}>
								{t("create")}
							</Button>
						</Modal.Footer>
					</Form>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
