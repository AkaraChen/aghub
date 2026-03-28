import {
	ArrowRightIcon,
	BookOpenIcon,
	CheckBadgeIcon,
	FolderIcon,
	ServerStackIcon,
	SquaresPlusIcon,
} from "@heroicons/react/24/solid";
import { Button, Card, Surface } from "@heroui/react";
import { emitTo } from "@tauri-apps/api/event";
import {
	getCurrentWebviewWindow,
	WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { startTransition, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useSetOnboardingCompleted } from "../../hooks/use-onboarding";
import { cn } from "../../lib/utils";
import "../../styles/onboarding.css";

type StepId = "welcome" | "mcp" | "skills" | "start";

const appIconUrl = new URL(
	"../../../src-tauri/icons/128x128.png",
	import.meta.url,
).href;

interface StepDefinition {
	id: StepId;
	eyebrowKey: string;
	titleKey: string;
	bodyKey: string;
	bulletKeys: string[];
}

const ONBOARDING_STEPS: StepDefinition[] = [
	{
		id: "welcome",
		eyebrowKey: "onboardingWelcomeEyebrow",
		titleKey: "onboardingWelcomeTitle",
		bodyKey: "onboardingWelcomeBody",
		bulletKeys: [
			"onboardingWelcomeBulletOne",
			"onboardingWelcomeBulletTwo",
		],
	},
	{
		id: "mcp",
		eyebrowKey: "onboardingMcpEyebrow",
		titleKey: "onboardingMcpTitle",
		bodyKey: "onboardingMcpBody",
		bulletKeys: ["onboardingMcpBulletOne", "onboardingMcpBulletTwo"],
	},
	{
		id: "skills",
		eyebrowKey: "onboardingSkillsEyebrow",
		titleKey: "onboardingSkillsTitle",
		bodyKey: "onboardingSkillsBody",
		bulletKeys: ["onboardingSkillsBulletOne", "onboardingSkillsBulletTwo"],
	},
	{
		id: "start",
		eyebrowKey: "onboardingStartEyebrow",
		titleKey: "onboardingStartTitle",
		bodyKey: "onboardingStartBody",
		bulletKeys: ["onboardingStartBulletOne", "onboardingStartBulletTwo"],
	},
];

function StepBullet({ children }: { children: React.ReactNode }) {
	return (
		<li className="flex items-start gap-2.5 text-sm leading-6 text-foreground">
			<span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
				<CheckBadgeIcon className="size-3.5" />
			</span>
			<span>{children}</span>
		</li>
	);
}

function StepProgress({ currentStep }: { currentStep: number }) {
	const { t } = useTranslation();
	const current = currentStep + 1;
	const total = ONBOARDING_STEPS.length;
	const progressLabel = t("onboardingStepCounter", { current, total });

	return (
		<div className="flex flex-col gap-2 md:items-end">
			<p className="text-xs font-medium tracking-[0.12em] text-muted uppercase">
				{progressLabel}
			</p>
			<div
				className="flex items-center gap-2"
				role="progressbar"
				aria-label={progressLabel}
				aria-valuemin={1}
				aria-valuemax={total}
				aria-valuenow={current}
			>
				{ONBOARDING_STEPS.map((step, index) => (
					<div
						key={step.id}
						className={cn(
							"h-1.5 w-10 rounded-full transition-colors",
							index <= currentStep ? "bg-accent" : "bg-border",
						)}
					/>
				))}
			</div>
		</div>
	);
}

function PreviewHeader({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="flex items-start gap-2.5">
			<div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
				{icon}
			</div>
			<div className="space-y-1">
				<p className="text-sm font-semibold text-foreground">{title}</p>
				<p className="text-sm leading-6 text-muted">{description}</p>
			</div>
		</div>
	);
}

function OverviewRow({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="flex items-start gap-2.5 rounded-2xl border border-border/70 bg-surface-secondary/90 p-3.5">
			<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
				{icon}
			</div>
			<div className="space-y-1">
				<p className="text-sm font-semibold text-foreground">{title}</p>
				<p className="text-sm leading-6 text-muted">{description}</p>
			</div>
		</div>
	);
}

function FlowStep({
	index,
	title,
	description,
}: {
	index: string;
	title: string;
	description: string;
}) {
	return (
		<div className="flex items-start gap-2.5 rounded-2xl border border-border/70 bg-surface-secondary/90 p-3.5">
			<div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-xs font-semibold text-accent">
				{index}
			</div>
			<div className="space-y-1">
				<p className="text-sm font-semibold text-foreground">{title}</p>
				<p className="text-sm leading-6 text-muted">{description}</p>
			</div>
		</div>
	);
}

function SkillExample({
	name,
	description,
}: {
	name: string;
	description: string;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-surface-secondary/90 px-3.5 py-3">
			<div className="min-w-0">
				<p className="text-sm font-semibold text-foreground">{name}</p>
				<p className="text-sm leading-6 text-muted">{description}</p>
			</div>
			<span className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted">
				SKILL.md
			</span>
		</div>
	);
}

function StartAction({
	icon,
	title,
	description,
	buttonLabel,
	onPress,
	isPending,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	buttonLabel: string;
	onPress: () => void;
	isPending: boolean;
}) {
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface-secondary/90 p-3.5">
			<div className="flex items-start gap-2.5">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
					{icon}
				</div>
				<div className="space-y-1">
					<p className="text-sm font-semibold text-foreground">
						{title}
					</p>
					<p className="text-sm leading-6 text-muted">
						{description}
					</p>
				</div>
			</div>
			<Button
				variant="secondary"
				className="justify-between"
				isDisabled={isPending}
				onPress={onPress}
			>
				<span>{buttonLabel}</span>
				<ArrowRightIcon className="size-4" />
			</Button>
		</div>
	);
}

function WelcomePreview({ agentCount }: { agentCount: number }) {
	const { t } = useTranslation();

	return (
		<Card className="border border-border/70 bg-surface/88 p-0">
			<Card.Content className="space-y-5 p-5">
				<div className="flex items-center gap-3">
					<img
						src={appIconUrl}
						alt=""
						className="size-12 rounded-[14px] border border-border/70"
					/>
					<div className="space-y-1">
						<p className="text-sm font-semibold text-foreground">
							{t("onboardingOverviewTitle")}
						</p>
						<p className="text-xs text-muted">
							{t("onboardingAgentCoverage", {
								count: agentCount,
							})}
						</p>
					</div>
				</div>

				<p className="text-sm leading-6 text-muted">
					{t("onboardingOverviewBody")}
				</p>

				<div className="space-y-2.5">
					<OverviewRow
						icon={<ServerStackIcon className="size-4" />}
						title={t("onboardingFeatureMcpTitle")}
						description={t("onboardingFeatureMcpDescription")}
					/>
					<OverviewRow
						icon={<BookOpenIcon className="size-4" />}
						title={t("onboardingFeatureSkillsTitle")}
						description={t("onboardingFeatureSkillsDescription")}
					/>
					<OverviewRow
						icon={<FolderIcon className="size-4" />}
						title={t("onboardingFeatureScopeTitle")}
						description={t("onboardingFeatureScopeDescription")}
					/>
				</div>
			</Card.Content>
		</Card>
	);
}

function McpPreview() {
	const { t } = useTranslation();

	return (
		<Card className="border border-border/70 bg-surface/88 p-0">
			<Card.Content className="space-y-5 p-5">
				<PreviewHeader
					icon={<ServerStackIcon className="size-5" />}
					title={t("onboardingMcpVisualTitle")}
					description={t("onboardingMcpVisualBody")}
				/>

				<div className="space-y-2.5">
					<FlowStep
						index="01"
						title={t("onboardingMcpFlowOneTitle")}
						description={t("onboardingMcpFlowOneBody")}
					/>
					<FlowStep
						index="02"
						title={t("onboardingMcpFlowTwoTitle")}
						description={t("onboardingMcpFlowTwoBody")}
					/>
					<FlowStep
						index="03"
						title={t("onboardingMcpFlowThreeTitle")}
						description={t("onboardingMcpFlowThreeBody")}
					/>
				</div>
			</Card.Content>
		</Card>
	);
}

function SkillsPreview() {
	const { t } = useTranslation();

	return (
		<Card className="border border-border/70 bg-surface/88 p-0">
			<Card.Content className="space-y-5 p-5">
				<PreviewHeader
					icon={<BookOpenIcon className="size-5" />}
					title={t("onboardingSkillsVisualTitle")}
					description={t("onboardingSkillsVisualBody")}
				/>

				<div className="space-y-2.5">
					<SkillExample
						name="review-pr"
						description={t("onboardingSkillExampleReview")}
					/>
					<SkillExample
						name="fix-ci"
						description={t("onboardingSkillExampleCi")}
					/>
					<SkillExample
						name="ship-feature"
						description={t("onboardingSkillExampleShip")}
					/>
				</div>
			</Card.Content>
		</Card>
	);
}

function StartPreview({
	onNavigate,
	isPending,
}: {
	onNavigate: (path: string) => void;
	isPending: boolean;
}) {
	const { t } = useTranslation();

	return (
		<Card className="border border-border/70 bg-surface/88 p-0">
			<Card.Content className="space-y-5 p-5">
				<PreviewHeader
					icon={<ArrowRightIcon className="size-5" />}
					title={t("onboardingNextStepTitle")}
					description={t("onboardingNextStepBody")}
				/>

				<div className="space-y-2.5">
					<StartAction
						icon={<ServerStackIcon className="size-4" />}
						title={t("onboardingStartMcpTitle")}
						description={t("onboardingStartMcpBody")}
						buttonLabel={t("onboardingStartMcpCta")}
						isPending={isPending}
						onPress={() => onNavigate("/mcp")}
					/>
					<StartAction
						icon={<BookOpenIcon className="size-4" />}
						title={t("onboardingStartSkillsTitle")}
						description={t("onboardingStartSkillsBody")}
						buttonLabel={t("onboardingStartSkillsCta")}
						isPending={isPending}
						onPress={() => onNavigate("/skills")}
					/>
					<StartAction
						icon={<SquaresPlusIcon className="size-4" />}
						title={t("onboardingStartMarketTitle")}
						description={t("onboardingStartMarketBody")}
						buttonLabel={t("onboardingStartMarketCta")}
						isPending={isPending}
						onPress={() => onNavigate("/skills-sh")}
					/>
				</div>
			</Card.Content>
		</Card>
	);
}

export default function OnboardingPage() {
	const { t } = useTranslation();
	const { allAgents } = useAgentAvailability();
	const setOnboardingCompleted = useSetOnboardingCompleted();
	const [stepIndex, setStepIndex] = useState(0);
	const [direction, setDirection] = useState<"forward" | "backward">(
		"forward",
	);

	const step = ONBOARDING_STEPS[stepIndex];
	const canGoBack = stepIndex > 0;
	const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;
	const agentCount = allAgents.length || 25;

	const handleStepChange = (nextIndex: number) => {
		if (nextIndex === stepIndex) {
			return;
		}

		setDirection(nextIndex > stepIndex ? "forward" : "backward");
		startTransition(() => {
			setStepIndex(nextIndex);
		});
	};

	const closeWindow = async () => {
		await getCurrentWebviewWindow().close();
	};

	const focusMainWindow = async () => {
		const mainWindow = await WebviewWindow.getByLabel("main");
		await mainWindow?.setFocus();
	};

	const markComplete = async () => {
		await setOnboardingCompleted.mutateAsync(true);
	};

	const navigateMainWindow = async (path: string) => {
		await markComplete();
		await emitTo("main", "navigate", path);
		await focusMainWindow();
		await closeWindow();
	};

	const finishOnboarding = async () => {
		await markComplete();
		await focusMainWindow();
		await closeWindow();
	};

	return (
		<Surface
			variant="secondary"
			className="flex min-h-screen flex-col overflow-hidden"
			data-onboarding-shell=""
		>
			<div data-tauri-drag-region className="h-6 shrink-0" />

			<div className="relative flex-1 overflow-auto p-3.5 md:p-5">
				<div
					className="pointer-events-none"
					data-onboarding-backdrop=""
				/>

				<div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col gap-4">
					<header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
						<div className="flex items-center gap-3">
							<img
								src={appIconUrl}
								alt=""
								className="size-11 rounded-2xl border border-border/70"
							/>
							<p className="text-base font-semibold text-foreground">
								{t("onboardingHeaderSubtitle")}
							</p>
						</div>

						<div className="flex items-center justify-between gap-3">
							<StepProgress currentStep={stepIndex} />
							<Button
								variant="tertiary"
								onPress={() => void finishOnboarding()}
								isDisabled={setOnboardingCompleted.isPending}
							>
								{t("onboardingSkip")}
							</Button>
						</div>
					</header>

					<div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,0.94fr)_minmax(420px,0.86fr)]">
						<Card className="border border-border/70 bg-surface/88 p-0">
							<Card.Content className="flex h-full flex-col gap-6 p-5 md:p-6">
								<div className="space-y-3">
									<span className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent">
										{t(step.eyebrowKey)}
									</span>

									<div className="space-y-2">
										<h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
											{t(step.titleKey)}
										</h1>
										<p className="max-w-xl text-base leading-7 text-muted md:text-[1.0625rem]">
											{t(step.bodyKey, {
												count: agentCount,
											})}
										</p>
									</div>
								</div>

								<ul className="space-y-2.5">
									{step.bulletKeys.map((bulletKey) => (
										<StepBullet key={bulletKey}>
											{t(bulletKey)}
										</StepBullet>
									))}
								</ul>

								<div className="mt-auto flex flex-wrap items-center justify-end gap-2.5 border-t border-separator pt-5">
									<div className="flex items-center gap-2.5">
										{canGoBack && (
											<Button
												variant="secondary"
												onPress={() =>
													handleStepChange(
														stepIndex - 1,
													)
												}
											>
												{t("back")}
											</Button>
										)}

										{isLastStep ? (
											<Button
												variant="secondary"
												onPress={() =>
													void finishOnboarding()
												}
												isPending={
													setOnboardingCompleted.isPending
												}
											>
												{t("onboardingMaybeLater")}
											</Button>
										) : (
											<Button
												variant="primary"
												onPress={() =>
													handleStepChange(
														stepIndex + 1,
													)
												}
											>
												{t("next")}
											</Button>
										)}
									</div>
								</div>
							</Card.Content>
						</Card>

						<div
							key={step.id}
							className="min-h-[420px]"
							data-onboarding-stage={direction}
						>
							{step.id === "welcome" && (
								<WelcomePreview agentCount={agentCount} />
							)}
							{step.id === "mcp" && <McpPreview />}
							{step.id === "skills" && <SkillsPreview />}
							{step.id === "start" && (
								<StartPreview
									onNavigate={navigateMainWindow}
									isPending={setOnboardingCompleted.isPending}
								/>
							)}
						</div>
					</div>

					{setOnboardingCompleted.isPending && (
						<p className="text-sm text-muted">
							{t("onboardingSavingProgress")}
						</p>
					)}
				</div>
			</div>
		</Surface>
	);
}
