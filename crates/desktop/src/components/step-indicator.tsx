interface StepIndicatorProps {
	currentStep: number;
	labels: string[];
}

export function StepIndicator({ currentStep, labels }: StepIndicatorProps) {
	return (
		<div className="mb-6 flex items-center justify-center gap-2">
			{labels.map((label, idx) => {
				const step = idx + 1;
				return (
					<div key={step} className="flex items-center gap-2">
						<div
							className={`
         flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
         ${
				step < currentStep
					? "bg-accent-soft text-accent"
					: step === currentStep
						? "bg-accent text-accent-foreground"
						: "bg-default-100 text-default-500"
			}
       `}
						>
							<span
								className={`
          flex size-4.5 items-center justify-center rounded-full text-[10px]
          font-bold shrink-0
          ${
				step < currentStep
					? "bg-accent text-accent-foreground"
					: step === currentStep
						? "bg-accent-foreground text-accent"
						: "bg-default-200 text-default-600"
			}
        `}
							>
								{step < currentStep ? "✓" : step}
							</span>
							{label}
						</div>
						{idx < labels.length - 1 && (
							<div
								className={`
          h-px w-6
          ${step < currentStep ? "bg-accent" : "bg-default-200"}
        `}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}
