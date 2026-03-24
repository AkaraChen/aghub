interface StepIndicatorProps {
	currentStep: number;
	labels: string[];
}

export function StepIndicator({ currentStep, labels }: StepIndicatorProps) {
	return (
		<div className="flex items-center justify-center gap-2 mb-6">
			{labels.map((label, idx) => {
				const step = idx + 1;
				return (
					<div key={step} className="flex items-center gap-2">
						<div
							className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
								step < currentStep
									? "bg-accent/15 text-accent"
									: step === currentStep
										? "bg-accent text-accent-foreground"
										: "bg-default-100 text-muted"
							}`}
						>
							<span
								className={`flex items-center justify-center size-4.5 rounded-full text-[10px] font-bold ${
									step < currentStep
										? "bg-accent text-accent-foreground"
										: step === currentStep
											? "bg-accent-foreground text-accent"
											: "bg-default-200 text-muted"
								}`}
							>
								{step < currentStep ? "✓" : step}
							</span>
							{label}
						</div>
						{idx < labels.length - 1 && (
							<div
								className={`w-6 h-px ${
									step < currentStep
										? "bg-accent"
										: "bg-default-200"
								}`}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}