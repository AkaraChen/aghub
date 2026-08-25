import { Button, Tooltip, type ButtonProps } from "@heroui/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface ProviderActionButtonProps extends Omit<
	ButtonProps,
	| "aria-label"
	| "children"
	| "className"
	| "isIconOnly"
	| "ref"
	| "size"
	| "variant"
> {
	accessibleName: string;
	children: ReactNode;
	className?: string;
	tooltip?: ReactNode;
}

export function ProviderActionButton({
	accessibleName,
	children,
	className,
	tooltip = accessibleName,
	...buttonProps
}: ProviderActionButtonProps) {
	return (
		<Tooltip delay={0}>
			<Tooltip.Trigger<"button">
				render={(triggerProps) => (
					<Button
						{...buttonProps}
						{...(triggerProps as ButtonProps)}
						isIconOnly
						size="sm"
						variant="ghost"
						aria-label={accessibleName}
						className={cn(className, triggerProps.className)}
					>
						{children}
					</Button>
				)}
			/>
			<Tooltip.Content>{tooltip}</Tooltip.Content>
		</Tooltip>
	);
}
