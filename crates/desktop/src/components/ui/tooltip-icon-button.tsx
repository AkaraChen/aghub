"use client";

import { Button, Tooltip } from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";

type TooltipIconButtonProps = Omit<
	ComponentProps<typeof Button>,
	"aria-label" | "children" | "isIconOnly"
> & {
	label: string;
	tooltip?: ReactNode;
	children: ReactNode;
	delay?: number;
};

export function TooltipIconButton({
	label,
	tooltip,
	children,
	delay = 0,
	...buttonProps
}: TooltipIconButtonProps) {
	return (
		<Tooltip delay={delay}>
			<Button {...buttonProps} isIconOnly aria-label={label}>
				{children}
			</Button>
			<Tooltip.Content>{tooltip ?? label}</Tooltip.Content>
		</Tooltip>
	);
}
