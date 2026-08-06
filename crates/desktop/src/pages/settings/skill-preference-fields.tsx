import { Card, Checkbox, Radio, Switch } from "@heroui/react";
import type { ReactNode } from "react";

export function SkillPreferenceSection({
	title,
	description,
	icon,
	children,
}: {
	title: string;
	description: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<Card className="min-w-0 gap-0 overflow-hidden p-0">
			<Card.Header className="flex flex-row items-start gap-3 border-b border-separator p-4">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
					{icon}
				</div>
				<div className="min-w-0 space-y-1">
					<h3 className="text-sm font-medium text-foreground">
						{title}
					</h3>
					<p className="text-xs leading-5 text-muted">
						{description}
					</p>
				</div>
			</Card.Header>
			<Card.Content className="min-w-0 space-y-4 p-4">
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
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
			className="w-full items-start rounded-xl border border-separator bg-surface-secondary p-3"
		>
			<Radio.Content className="min-w-0 items-start gap-2.5">
				<Radio.Control className="mt-0.5 shrink-0">
					<Radio.Indicator />
				</Radio.Control>
				<span className="mt-0.5 shrink-0 text-muted">{icon}</span>
				<span className="min-w-0 space-y-0.5">
					<span className="block text-sm text-foreground">
						{label}
					</span>
					<span className="block text-xs leading-4 text-muted">
						{description}
					</span>
				</span>
			</Radio.Content>
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
			className="w-full py-3"
		>
			<Switch.Content className="w-full items-center justify-between gap-4">
				<span className="min-w-0 space-y-0.5">
					<span className="block text-sm text-foreground">
						{label}
					</span>
					<span className="block text-xs text-muted">
						{description}
					</span>
				</span>
				<Switch.Control className="shrink-0">
					<Switch.Thumb />
				</Switch.Control>
			</Switch.Content>
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
			className="w-full items-start px-3 py-3"
		>
			<Checkbox.Control className="shrink-0">
				<Checkbox.Indicator />
			</Checkbox.Control>
			<Checkbox.Content className="min-w-0 items-start gap-2.5">
				<span className="mt-0.5 shrink-0 text-muted">{icon}</span>
				<span className="min-w-0 space-y-0.5">
					<span className="block text-sm text-foreground">
						{label}
					</span>
					<span className="block text-xs leading-4 text-muted">
						{description}
					</span>
				</span>
			</Checkbox.Content>
		</Checkbox>
	);
}
