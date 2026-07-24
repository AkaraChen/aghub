import { Label, ListBox, Select } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { MarketMcpInstallMethod } from "../../generated/dto";

interface McpInstallMethodSelectorProps {
	methods: MarketMcpInstallMethod[];
	selected: MarketMcpInstallMethod;
	onChange: (method: MarketMcpInstallMethod) => void;
}

export function McpInstallMethodSelector({
	methods,
	selected,
	onChange,
}: McpInstallMethodSelectorProps) {
	const { t } = useTranslation();

	return (
		<Select
			value={selected.id}
			onChange={(key) => {
				const method = methods.find(
					(candidate) => candidate.id === String(key),
				);
				if (method) onChange(method);
			}}
			variant="secondary"
			className="w-full"
		>
			<Label>{t("marketMcpInstallMethod")}</Label>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{methods.map((method) => (
						<ListBox.Item
							key={method.id}
							id={method.id}
							textValue={method.label}
						>
							{method.label}
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
