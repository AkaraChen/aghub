import { cn } from "../../lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="empty"
			className={cn(
				`
      flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg
      border border-dashed border-border p-6 text-center text-balance
      md:p-12
    `,
				className,
			)}
			{...props}
		/>
	);
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="empty-header"
			className={cn(
				"flex max-w-sm flex-col items-center gap-2 text-center",
				className,
			)}
			{...props}
		/>
	);
}

function EmptyMedia({
	className,
	variant = "default",
	...props
}: React.ComponentProps<"div"> & { variant?: "default" | "icon" }) {
	return (
		<div
			data-slot="empty-icon"
			data-variant={variant}
			className={cn(
				`
      mb-2 flex shrink-0 items-center justify-center
      [&_svg]:pointer-events-none [&_svg]:shrink-0
    `,
				variant === "icon" &&
					`
       size-10 rounded-lg bg-surface-secondary text-foreground
       [&_svg:not([class*="size-"])]:size-6
     `,
				className,
			)}
			{...props}
		/>
	);
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="empty-title"
			className={cn(
				"text-lg font-medium tracking-tight text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<div
			data-slot="empty-description"
			className={cn(
				`
      text-sm/relaxed text-muted
      [&>a]:underline [&>a]:underline-offset-4
      [&>a:hover]:text-accent
    `,
				className,
			)}
			{...props}
		/>
	);
}

export { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle };
