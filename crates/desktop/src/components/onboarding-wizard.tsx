import {
	ArrowsPointingOutIcon,
	BookOpenIcon,
	FolderIcon,
	PuzzlePieceIcon,
	ServerIcon,
	ShieldCheckIcon,
	SparklesIcon,
} from "@heroicons/react/24/solid";
import { Checkbox, Spinner } from "@heroui/react";
import { type ReactNode, useRef, useState } from "react";
import type {
	FeatureStep,
	FeatureStepId,
	WizardStep,
} from "../lib/onboarding-wizard";
import { cn } from "../lib/utils";
import type { WhatsNewItem } from "../lib/whats-new";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface OnboardingWizardProps {
	step: WizardStep;
	steps: WizardStep[];
	currentStep: number;
	onSelectStep: (step: number) => void;
	analyticsOptIn: boolean;
	onAnalyticsOptInChange: (value: boolean) => void;
	t: Translate;
}

const FEATURE_ICONS: Record<FeatureStepId, ReactNode> = {
	mcp: <ServerIcon className="size-5" />,
	skills: <BookOpenIcon className="size-5" />,
	projects: <FolderIcon className="size-5" />,
};

const WHATS_NEW_ICONS = {
	sparkles: <SparklesIcon className="size-5" />,
	puzzle: <PuzzlePieceIcon className="size-5" />,
	shield: <ShieldCheckIcon className="size-5" />,
} as const;

export function OnboardingWizard({
	step,
	steps,
	currentStep,
	onSelectStep,
	analyticsOptIn,
	onAnalyticsOptInChange,
	t,
}: OnboardingWizardProps) {
	if (step.type === "feature") {
		const featureIndices = steps
			.map((candidate, index) =>
				candidate.type === "feature" ? index : -1,
			)
			.filter((index) => index !== -1);

		return (
			<div className="grid gap-5 sm:grid-cols-[2fr_3fr]">
				<div className="flex flex-col justify-center gap-1.5">
					{featureIndices.map((index) => {
						const featureStep = steps[index] as FeatureStep;
						const active = index === currentStep;

						return (
							<button
								key={featureStep.id}
								type="button"
								className={cn(
									"flex gap-3 rounded-xl p-3 text-left transition-colors",
									active
										? "bg-surface-secondary"
										: "bg-transparent hover:bg-surface-secondary/30",
								)}
								onClick={() => onSelectStep(index)}
							>
								<div
									className={cn(
										"flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
										active
											? "bg-foreground text-background"
											: "bg-surface/40 text-muted/30",
									)}
								>
									{FEATURE_ICONS[featureStep.id]}
								</div>
								<div className="min-w-0 space-y-1">
									<p
										className={cn(
											"text-sm font-semibold transition-colors",
											active
												? "text-foreground"
												: "text-muted/40",
										)}
									>
										{t(featureStep.titleKey)}
									</p>
									{active && (
										<p className="text-xs leading-5 text-muted">
											{t(featureStep.descriptionKey)}
										</p>
									)}
								</div>
							</button>
						);
					})}
				</div>
				<WizardIllustration
					stepId={step.id}
					fullscreenLabel={t("onboardingFullscreen")}
				/>
			</div>
		);
	}

	if (step.type === "whats-new") {
		return (
			<div className="space-y-3">
				<div className="space-y-1">
					<p className="text-xs font-medium uppercase tracking-wider text-accent">
						{t("whatsNewSectionLabel", {
							version: step.entry.version,
						})}
					</p>
					<h3 className="text-lg font-semibold">
						{t(step.entry.titleKey)}
					</h3>
					<p className="text-sm text-muted">
						{t(step.entry.subtitleKey)}
					</p>
				</div>
				<ul className="divide-y divide-border">
					{step.entry.items.map((item: WhatsNewItem) => (
						<li key={item.titleKey} className="flex gap-3 py-3">
							<div className="shrink-0 pt-0.5 text-muted">
								{WHATS_NEW_ICONS[item.iconKey]}
							</div>
							<div className="min-w-0 space-y-1">
								<p className="text-sm font-semibold">
									{t(item.titleKey)}
								</p>
								<p className="text-xs leading-5 text-muted">
									{t(item.descriptionKey)}
								</p>
							</div>
						</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="space-y-1">
				<h3 className="text-lg font-semibold">
					{t("onboardingAnalyticsTitle")}
				</h3>
				<p className="text-sm text-muted">
					{t("onboardingAnalyticsDescription")}
				</p>
			</div>
			<div className="rounded-xl border border-border bg-surface-secondary/50 p-4">
				<Checkbox
					variant="secondary"
					isSelected={analyticsOptIn}
					onChange={onAnalyticsOptInChange}
				>
					<Checkbox.Control>
						<Checkbox.Indicator />
					</Checkbox.Control>
					<Checkbox.Content>
						<p className="text-sm font-medium">
							{t("settingsAnalyticsToggleLabel")}
						</p>
					</Checkbox.Content>
				</Checkbox>
			</div>
		</div>
	);
}

const WIZARD_VIDEOS: Record<FeatureStepId, string> = {
	mcp: "https://cdn.jsdelivr.net/gh/AkaraChen/aghub-docs@main/public/mcp.mp4",
	skills: "https://cdn.jsdelivr.net/gh/AkaraChen/aghub-docs@main/public/skills.mp4",
	projects:
		"https://cdn.jsdelivr.net/gh/AkaraChen/aghub-docs@main/public/project.mp4",
};

function WizardIllustration({
	stepId,
	fullscreenLabel,
}: {
	stepId: FeatureStepId;
	fullscreenLabel: string;
}) {
	const videoSrc = WIZARD_VIDEOS[stepId];
	const [isLoading, setIsLoading] = useState(true);
	const videoRef = useRef<HTMLVideoElement>(null);

	const handleFullscreen = () => {
		const video = videoRef.current;
		if (!video) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void video.requestFullscreen();
		}
	};

	return (
		<div className="group relative flex min-h-80 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-secondary/60">
			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center">
					<Spinner size="lg" />
				</div>
			)}
			<video
				ref={videoRef}
				key={stepId}
				className={cn(
					"size-full object-cover transition-opacity",
					isLoading ? "opacity-0" : "opacity-100",
				)}
				src={videoSrc}
				autoPlay
				loop
				muted
				playsInline
				onCanPlay={() => setIsLoading(false)}
				onLoadStart={() => setIsLoading(true)}
			/>
			<button
				type="button"
				aria-label={fullscreenLabel}
				className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md bg-foreground/80 text-background opacity-0 transition-opacity hover:bg-foreground focus-visible:opacity-100 group-hover:opacity-100"
				onClick={handleFullscreen}
			>
				<ArrowsPointingOutIcon className="size-4" />
			</button>
		</div>
	);
}
