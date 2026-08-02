import {
	ChevronDownIcon,
	ExclamationTriangleIcon,
} from "@heroicons/react/24/solid";
import { Accordion, Alert, Button, Spinner } from "@heroui/react";

export function SkillComparisonLoading({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-2 py-1 text-xs text-muted">
			<Spinner size="sm" />
			<span>{label}</span>
		</div>
	);
}

export function SkillComparisonMatchAlert({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<Alert status="success" role="status">
			<Alert.Indicator />
			<Alert.Content>
				<Alert.Title>{title}</Alert.Title>
				<Alert.Description>{description}</Alert.Description>
			</Alert.Content>
		</Alert>
	);
}

export function SkillComparisonUnavailableAlert({
	title,
	description,
	actionLabel,
	isPending = false,
	onAction,
}: {
	title: string;
	description: string;
	actionLabel?: string;
	isPending?: boolean;
	onAction?: () => void;
}) {
	return (
		<Alert status="warning" role="status">
			<Alert.Indicator />
			<Alert.Content>
				<Alert.Title>{title}</Alert.Title>
				<Alert.Description>{description}</Alert.Description>
			</Alert.Content>
			{actionLabel && onAction && (
				<Button
					variant="ghost"
					size="sm"
					isPending={isPending}
					onPress={onAction}
				>
					{actionLabel}
				</Button>
			)}
		</Alert>
	);
}

export function SkillDriftHeading({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<Accordion.Heading>
			<Accordion.Trigger>
				<div className="flex min-w-0 flex-1 items-center gap-3 text-left">
					<ExclamationTriangleIcon className="size-4 shrink-0 text-warning" />
					<div className="min-w-0">
						<p>{title}</p>
						<p className="truncate text-xs font-normal text-muted">
							{description}
						</p>
					</div>
				</div>
				<Accordion.Indicator>
					<ChevronDownIcon className="size-4" />
				</Accordion.Indicator>
			</Accordion.Trigger>
		</Accordion.Heading>
	);
}
