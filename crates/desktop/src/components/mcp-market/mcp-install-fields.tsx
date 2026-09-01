import {
	Description,
	FieldError,
	Input,
	Label,
	ListBox,
	Select,
	TextField,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { MarketMcpInput } from "../../generated/dto";

interface McpInstallFieldsProps {
	inputs: MarketMcpInput[];
	values: Record<string, string>;
	invalidIds: Set<string>;
	onChange: (id: string, value: string) => void;
}

function choicesFor(input: MarketMcpInput): string[] {
	if (input.choices.length > 0) return input.choices;
	return input.format === "boolean" ? ["true", "false"] : [];
}

export function McpInstallFields({
	inputs,
	values,
	invalidIds,
	onChange,
}: McpInstallFieldsProps) {
	const { t } = useTranslation();

	return (
		<div className="space-y-3">
			<p className="text-sm font-medium">{t("marketMcpInputs")}</p>
			{inputs.map((input) => {
				const value = values[input.id] ?? "";
				const choices = choicesFor(input);
				const isInvalid = invalidIds.has(input.id);
				const error = value.trim()
					? t("marketMcpInvalidValue")
					: t("marketMcpRequired");

				if (choices.length > 0) {
					return (
						<Select
							key={input.id}
							name={input.id}
							value={value || null}
							onChange={(key) =>
								onChange(input.id, String(key ?? ""))
							}
							isRequired={input.is_required}
							isInvalid={isInvalid}
							variant="secondary"
							className="w-full"
						>
							<Label>{input.label}</Label>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{choices.map((choice) => (
										<ListBox.Item
											key={choice}
											id={choice}
											textValue={choice}
										>
											{choice}
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
							{isInvalid && <FieldError>{error}</FieldError>}
						</Select>
					);
				}

				return (
					<TextField
						key={input.id}
						name={input.id}
						type={
							input.is_secret
								? "password"
								: input.format === "number"
									? "number"
									: "text"
						}
						isRequired={input.is_required}
						isInvalid={isInvalid}
						className="w-full"
						variant="secondary"
					>
						<Label>{input.label}</Label>
						<Input
							value={value}
							onChange={(event) =>
								onChange(input.id, event.target.value)
							}
							placeholder={
								input.placeholder ??
								(input.is_secret
									? t("marketMcpSecretPlaceholder")
									: undefined)
							}
							variant="secondary"
						/>
						{input.description && (
							<Description>{input.description}</Description>
						)}
						{isInvalid && <FieldError>{error}</FieldError>}
					</TextField>
				);
			})}
		</div>
	);
}
