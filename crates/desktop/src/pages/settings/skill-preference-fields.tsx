import {
	Card,
	Checkbox,
	Description,
	Label,
	Radio,
	Switch,
} from "@heroui/react";
import type { ReactNode } from "react";

export function SkillPreferenceSection({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<Card className="min-w-0 p-0">
			<Card.Content className="min-w-0 space-y-4 p-4">
				<div className="min-w-0 space-y-0.5">
					<h3 className="text-sm font-medium text-foreground">
						{title}
					</h3>
					<p className="text-xs text-muted">{description}</p>
				</div>
				{children}
			</Card.Content>
		</Card>
	);
}

export function SkillPreferenceChoice({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
			<div className="min-w-0 space-y-0.5">
				<SkillPreferenceLabel>{title}</SkillPreferenceLabel>
				<p className="text-xs text-muted">{description}</p>
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

export function SkillPreferenceLabel({ children }: { children: ReactNode }) {
	return <p className="text-sm font-medium text-foreground">{children}</p>;
}

export function SkillPreferenceRadio({
	value,
	label,
	description,
	icon,
}: {
	value: string;
	label: string;
	description: string;
	icon: ReactNode;
}) {
	return (
		<Radio
			value={value}
			className="flex w-full min-w-0 flex-col items-stretch rounded-xl border border-separator bg-surface-secondary p-3"
		>
			<Radio.Content className="flex min-w-0 items-center gap-2.5">
				<Radio.Control className="mt-0.5 shrink-0">
					<Radio.Indicator />
				</Radio.Control>
				<span className="shrink-0 text-muted">{icon}</span>
				<Label className="min-w-0 text-sm text-foreground">
					{label}
				</Label>
			</Radio.Content>
			<Description className="mt-1 block pl-12 text-xs leading-4 text-muted">
				{description}
			</Description>
		</Radio>
	);
}

export function SkillPreferenceSwitch({
	label,
	description,
	selected,
	disabled,
	onChange,
}: {
	label: string;
	description: string;
	selected: boolean;
	disabled: boolean;
	onChange: (selected: boolean) => void;
}) {
	return (
		<Switch
			isSelected={selected}
			isDisabled={disabled}
			onChange={onChange}
			className="flex w-full min-w-0 flex-col py-3"
		>
			<Switch.Content className="w-full items-center justify-between gap-4">
				<Label className="min-w-0 text-sm text-foreground">
					{label}
				</Label>
				<Switch.Control className="shrink-0">
					<Switch.Thumb />
				</Switch.Control>
			</Switch.Content>
			<Description className="mt-0.5 ml-0 block pl-0 pr-12 text-xs text-muted">
				{description}
			</Description>
		</Switch>
	);
}

export function SkillDiscoveryCheckbox({
	label,
	description,
	icon,
	selected,
	disabled,
	onChange,
}: {
	label: string;
	description: string;
	icon: ReactNode;
	selected: boolean;
	disabled: boolean;
	onChange: (selected: boolean) => void;
}) {
	return (
		<Checkbox
			isSelected={selected}
			isDisabled={disabled}
			onChange={onChange}
			className="flex w-full min-w-0 flex-col items-stretch px-3 py-3"
		>
			<Checkbox.Content className="flex min-w-0 items-center gap-2.5">
				<Checkbox.Control className="shrink-0">
					<Checkbox.Indicator />
				</Checkbox.Control>
				<span className="shrink-0 text-muted">{icon}</span>
				<Label className="min-w-0 text-sm text-foreground">
					{label}
				</Label>
			</Checkbox.Content>
			<Description className="mt-1 block pl-12 text-xs leading-4 text-muted">
				{description}
			</Description>
		</Checkbox>
	);
}
