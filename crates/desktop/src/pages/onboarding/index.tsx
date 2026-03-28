import {
	ArrowRightIcon,
	BookOpenIcon,
	CheckBadgeIcon,
	CommandLineIcon,
	FolderIcon,
	GlobeAltIcon,
	ServerStackIcon,
	ShieldCheckIcon,
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

type StepId = "welcome" | "mcp" | "skills" | "scope";

interface StepDefinition {
	id: StepId;
	indexLabel: string;
	eyebrowKey: string;
	titleKey: string;
	bodyKey: string;
	bulletKeys: string[];
}

const ONBOARDING_STEPS: StepDefinition[] = [
	{
		id: "welcome",
		indexLabel: "01",
		eyebrowKey: "onboardingWelcomeEyebrow",
		titleKey: "onboardingWelcomeTitle",
		bodyKey: "onboardingWelcomeBody",
		bulletKeys: [
			"onboardingWelcomeBulletOne",
			"onboardingWelcomeBulletTwo",
			"onboardingWelcomeBulletThree",
		],
	},
	{
		id: "mcp",
		indexLabel: "02",
		eyebrowKey: "onboardingMcpEyebrow",
		titleKey: "onboardingMcpTitle",
		bodyKey: "onboardingMcpBody",
		bulletKeys: [
			"onboardingMcpBulletOne",
			"onboardingMcpBulletTwo",
			"onboardingMcpBulletThree",
		],
	},
	{
		id: "skills",
		indexLabel: "03",
		eyebrowKey: "onboardingSkillsEyebrow",
		titleKey: "onboardingSkillsTitle",
		bodyKey: "onboardingSkillsBody",
		bulletKeys: [
			"onboardingSkillsBulletOne",
			"onboardingSkillsBulletTwo",
			"onboardingSkillsBulletThree",
		],
	},
	{
		id: "scope",
		indexLabel: "04",
		eyebrowKey: "onboardingScopeEyebrow",
		titleKey: "onboardingScopeTitle",
		bodyKey: "onboardingScopeBody",
		bulletKeys: [
			"onboardingScopeBulletOne",
			"onboardingScopeBulletTwo",
			"onboardingScopeBulletThree",
		],
	},
];

interface StatCardProps {
	label: string;
	value: string;
	description: string;
}

function StatCard({ label, value, description }: StatCardProps) {
	return (
		<Card
			variant="secondary"
			className="border border-border/70 bg-surface/85 p-0"
		>
			<Card.Content className="space-y-2 p-4">
				<p className="text-[11px] font-semibold tracking-[0.24em] text-muted uppercase">
					{label}
				</p>
				<p className="text-2xl font-semibold tracking-tight text-foreground">
					{value}
				</p>
				<p className="text-sm leading-6 text-muted">{description}</p>
			</Card.Content>
		</Card>
	);
}

interface StepBulletProps {
	children: React.ReactNode;
}

function StepBullet({ children }: StepBulletProps) {
	return (
		<li className="flex items-start gap-3 text-sm leading-6 text-foreground">
			<span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
				<CheckBadgeIcon className="size-3.5" />
			</span>
			<span>{children}</span>
		</li>
	);
}

interface StepNavProps {
	currentStep: number;
	onSelect: (index: number) => void;
}

function StepNav({ currentStep, onSelect }: StepNavProps) {
	const { t } = useTranslation();

	return (
		<div className="flex items-center gap-2">
			{ONBOARDING_STEPS.map((step, index) => (
				<button
					key={step.id}
					type="button"
					className={cn(
						`
							flex h-9 items-center gap-2 rounded-full border px-3
							text-xs font-medium transition-colors
						`,
						index === currentStep
							? "border-accent/35 bg-accent/12 text-foreground"
							: "border-border/70 bg-surface/70 text-muted hover:border-border hover:text-foreground",
					)}
					onClick={() => onSelect(index)}
				>
					<span className="text-[10px] tracking-[0.22em] uppercase">
						{step.indexLabel}
					</span>
					<span className="hidden sm:inline">
						{t(step.eyebrowKey)}
					</span>
				</button>
			))}
		</div>
	);
}

function WelcomeVisual({ agentCount }: { agentCount: number }) {
	const { t } = useTranslation();

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
			<Card className="border border-border/70 bg-surface/88 p-0">
				<Card.Content className="space-y-5 p-5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-accent uppercase">
							{t("onboardingHeroBadge")}
						</span>
						<span className="rounded-full border border-border/70 bg-surface-secondary/90 px-3 py-1 text-xs text-muted">
							{t("onboardingAgentCoverage", {
								count: agentCount,
							})}
						</span>
					</div>

					<div className="space-y-2">
						<p className="text-sm text-muted">
							{t("onboardingWelcomeVisualIntro")}
						</p>
						<div className="grid gap-3 md:grid-cols-3">
							<FeatureCallout
								icon={<ServerStackIcon className="size-4" />}
								title={t("onboardingFeatureMcpTitle")}
								description={t(
									"onboardingFeatureMcpDescription",
								)}
							/>
							<FeatureCallout
								icon={<BookOpenIcon className="size-4" />}
								title={t("onboardingFeatureSkillsTitle")}
								description={t(
									"onboardingFeatureSkillsDescription",
								)}
							/>
							<FeatureCallout
								icon={<FolderIcon className="size-4" />}
								title={t("onboardingFeatureScopeTitle")}
								description={t(
									"onboardingFeatureScopeDescription",
								)}
							/>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						{[
							"Claude Code",
							"Cursor",
							"Codex",
							"Copilot",
							"Kiro",
							"OpenCode",
						].map((agent) => (
							<span
								key={agent}
								className="
									rounded-full border border-border/70 bg-surface-secondary/90
									px-3 py-1 text-xs text-foreground/85
								"
							>
								{agent}
							</span>
						))}
						<span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted">
							{t("onboardingMoreAgents")}
						</span>
					</div>
				</Card.Content>
			</Card>

			<div className="grid gap-4">
				<StatCard
					label={t("onboardingStatConfigure")}
					value={t("onboardingStatConfigureValue")}
					description={t("onboardingStatConfigureDescription")}
				/>
				<StatCard
					label={t("onboardingStatReview")}
					value={t("onboardingStatReviewValue")}
					description={t("onboardingStatReviewDescription")}
				/>
				<StatCard
					label={t("onboardingStatScope")}
					value={t("onboardingStatScopeValue")}
					description={t("onboardingStatScopeDescription")}
				/>
			</div>
		</div>
	);
}

function McpVisual() {
	const { t } = useTranslation();

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
			<Card className="border border-border/70 bg-surface/88 p-0">
				<Card.Content className="space-y-5 p-5">
					<div className="flex items-center gap-3">
						<div className="flex size-11 items-center justify-center rounded-2xl bg-accent/14 text-accent">
							<ServerStackIcon className="size-5" />
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">
								{t("onboardingMcpVisualTitle")}
							</p>
							<p className="text-sm text-muted">
								{t("onboardingMcpVisualBody")}
							</p>
						</div>
					</div>

					<div className="grid gap-3">
						<TransportCard
							icon={<CommandLineIcon className="size-4" />}
							title="stdio"
							description={t("onboardingMcpTransportStdio")}
							accentClass="bg-accent/10 text-accent"
						/>
						<TransportCard
							icon={<GlobeAltIcon className="size-4" />}
							title="SSE"
							description={t("onboardingMcpTransportSse")}
							accentClass="bg-foreground/8 text-foreground"
						/>
						<TransportCard
							icon={<ShieldCheckIcon className="size-4" />}
							title="HTTP"
							description={t("onboardingMcpTransportHttp")}
							accentClass="bg-success/14 text-success"
						/>
					</div>
				</Card.Content>
			</Card>

			<Card variant="secondary" className="border border-border/70 p-0">
				<Card.Content className="space-y-4 p-5">
					<p className="text-[11px] font-semibold tracking-[0.24em] text-muted uppercase">
						{t("onboardingMcpAppliesLabel")}
					</p>
					<div className="space-y-3">
						<AgentWireRow
							name="github"
							agents={["Claude", "Cursor", "Codex"]}
						/>
						<AgentWireRow
							name="filesystem"
							agents={["OpenCode", "Copilot", "Kiro"]}
						/>
						<AgentWireRow
							name="browser"
							agents={["Mistral", "Gemini", "Cline"]}
						/>
					</div>
				</Card.Content>
			</Card>
		</div>
	);
}

function SkillsVisual() {
	const { t } = useTranslation();

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
			<Card className="border border-border/70 bg-surface/88 p-0">
				<Card.Content className="space-y-4 p-5">
					<div className="flex items-center gap-3">
						<div className="flex size-11 items-center justify-center rounded-2xl bg-accent/14 text-accent">
							<BookOpenIcon className="size-5" />
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">
								{t("onboardingSkillsVisualTitle")}
							</p>
							<p className="text-sm text-muted">
								{t("onboardingSkillsVisualBody")}
							</p>
						</div>
					</div>

					<div className="grid gap-3 md:grid-cols-2">
						<SkillCard
							title="review-pr"
							description={t("onboardingSkillExampleReview")}
							tag="SKILL.md"
						/>
						<SkillCard
							title="fix-ci"
							description={t("onboardingSkillExampleCi")}
							tag="tools: gh, rg"
						/>
						<SkillCard
							title="ship-feature"
							description={t("onboardingSkillExampleShip")}
							tag=".skill bundle"
						/>
						<SkillCard
							title="skills.sh"
							description={t("onboardingSkillExampleMarket")}
							tag="market"
						/>
					</div>
				</Card.Content>
			</Card>

			<Card variant="secondary" className="border border-border/70 p-0">
				<Card.Content className="space-y-4 p-5">
					<p className="text-[11px] font-semibold tracking-[0.24em] text-muted uppercase">
						{t("onboardingSkillsSignalsLabel")}
					</p>

					<div className="space-y-3">
						<SignalRow
							icon={<SquaresPlusIcon className="size-4" />}
							title={t("onboardingSignalMarketTitle")}
							description={t("onboardingSignalMarketBody")}
						/>
						<SignalRow
							icon={<ShieldCheckIcon className="size-4" />}
							title={t("onboardingSignalProvenanceTitle")}
							description={t("onboardingSignalProvenanceBody")}
						/>
						<SignalRow
							icon={<CommandLineIcon className="size-4" />}
							title={t("onboardingSignalToolsTitle")}
							description={t("onboardingSignalToolsBody")}
						/>
					</div>
				</Card.Content>
			</Card>
		</div>
	);
}

interface StartActionProps {
	title: string;
	description: string;
	icon: React.ReactNode;
	onPress: () => void;
	variant?: "primary" | "secondary";
	isDisabled?: boolean;
}

function StartAction({
	title,
	description,
	icon,
	onPress,
	variant = "secondary",
	isDisabled = false,
}: StartActionProps) {
	return (
		<Card variant="secondary" className="border border-border/70 p-0">
			<Card.Content className="flex h-full flex-col gap-4 p-4">
				<div className="flex size-10 items-center justify-center rounded-2xl bg-surface-secondary text-accent">
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
				<Button
					variant={variant}
					className="mt-auto justify-between"
					isDisabled={isDisabled}
					onPress={onPress}
				>
					<span>{title}</span>
					<ArrowRightIcon className="size-4" />
				</Button>
			</Card.Content>
		</Card>
	);
}

function ScopeVisual({
	onNavigate,
	isPending,
}: {
	onNavigate: (path: string) => void;
	isPending: boolean;
}) {
	const { t } = useTranslation();

	return (
		<div className="grid gap-4">
			<div className="grid gap-4 xl:grid-cols-3">
				<ScopeColumn
					title={t("onboardingScopeGlobalTitle")}
					description={t("onboardingScopeGlobalBody")}
					items={[
						t("onboardingScopeGlobalItemOne"),
						t("onboardingScopeGlobalItemTwo"),
					]}
				/>
				<ScopeColumn
					title={t("onboardingScopeProjectTitle")}
					description={t("onboardingScopeProjectBody")}
					items={[
						t("onboardingScopeProjectItemOne"),
						t("onboardingScopeProjectItemTwo"),
					]}
				/>
				<ScopeColumn
					title={t("onboardingScopeMergedTitle")}
					description={t("onboardingScopeMergedBody")}
					items={[
						t("onboardingScopeMergedItemOne"),
						t("onboardingScopeMergedItemTwo"),
					]}
				/>
			</div>

			<Card className="border border-border/70 bg-surface/88 p-0">
				<Card.Content className="space-y-4 p-5">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p className="text-sm font-semibold text-foreground">
								{t("onboardingNextStepTitle")}
							</p>
							<p className="text-sm text-muted">
								{t("onboardingNextStepBody")}
							</p>
						</div>
						<span className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs text-accent">
							{t("onboardingReplayHint")}
						</span>
					</div>

					<div className="grid gap-4 lg:grid-cols-3">
						<StartAction
							title={t("onboardingStartMcpTitle")}
							description={t("onboardingStartMcpBody")}
							icon={<ServerStackIcon className="size-4" />}
							variant="primary"
							isDisabled={isPending}
							onPress={() => onNavigate("/mcp")}
						/>
						<StartAction
							title={t("onboardingStartSkillsTitle")}
							description={t("onboardingStartSkillsBody")}
							icon={<BookOpenIcon className="size-4" />}
							isDisabled={isPending}
							onPress={() => onNavigate("/skills")}
						/>
						<StartAction
							title={t("onboardingStartMarketTitle")}
							description={t("onboardingStartMarketBody")}
							icon={<SquaresPlusIcon className="size-4" />}
							isDisabled={isPending}
							onPress={() => onNavigate("/skills-sh")}
						/>
					</div>
				</Card.Content>
			</Card>

			{isPending && (
				<p className="text-sm text-muted">
					{t("onboardingSavingProgress")}
				</p>
			)}
		</div>
	);
}

function FeatureCallout({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<Card variant="secondary" className="border border-border/70 p-0">
			<Card.Content className="space-y-3 p-4">
				<div className="flex size-9 items-center justify-center rounded-2xl bg-accent/14 text-accent">
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
			</Card.Content>
		</Card>
	);
}

function TransportCard({
	icon,
	title,
	description,
	accentClass,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	accentClass: string;
}) {
	return (
		<div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-surface-secondary/90 p-4">
			<div
				className={cn(
					"flex size-9 items-center justify-center rounded-xl",
					accentClass,
				)}
			>
				{icon}
			</div>
			<div className="space-y-1">
				<p className="text-sm font-semibold text-foreground">{title}</p>
				<p className="text-sm leading-6 text-muted">{description}</p>
			</div>
		</div>
	);
}

function AgentWireRow({ name, agents }: { name: string; agents: string[] }) {
	return (
		<div className="rounded-2xl border border-border/70 bg-surface-secondary/90 p-4">
			<div className="flex flex-wrap items-center gap-2">
				<span className="rounded-full border border-border/70 px-3 py-1 text-xs font-medium text-foreground">
					{name}
				</span>
				<ArrowRightIcon className="size-4 text-muted" />
				{agents.map((agent) => (
					<span
						key={agent}
						className="rounded-full bg-surface px-3 py-1 text-xs text-muted"
					>
						{agent}
					</span>
				))}
			</div>
		</div>
	);
}

function SkillCard({
	title,
	description,
	tag,
}: {
	title: string;
	description: string;
	tag: string;
}) {
	return (
		<div className="rounded-2xl border border-border/70 bg-surface-secondary/90 p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<p className="text-sm font-semibold text-foreground">{title}</p>
				<span className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted">
					{tag}
				</span>
			</div>
			<p className="text-sm leading-6 text-muted">{description}</p>
		</div>
	);
}

function SignalRow({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="flex gap-3 rounded-2xl border border-border/70 bg-surface-secondary/90 p-4">
			<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
				{icon}
			</div>
			<div>
				<p className="text-sm font-semibold text-foreground">{title}</p>
				<p className="mt-1 text-sm leading-6 text-muted">
					{description}
				</p>
			</div>
		</div>
	);
}

function ScopeColumn({
	title,
	description,
	items,
}: {
	title: string;
	description: string;
	items: string[];
}) {
	return (
		<Card className="border border-border/70 bg-surface/88 p-0">
			<Card.Content className="space-y-4 p-5">
				<div className="space-y-1">
					<p className="text-sm font-semibold text-foreground">
						{title}
					</p>
					<p className="text-sm leading-6 text-muted">
						{description}
					</p>
				</div>
				<div className="space-y-2">
					{items.map((item) => (
						<div
							key={item}
							className="rounded-2xl border border-border/70 bg-surface-secondary/90 px-4 py-3 text-sm text-foreground/90"
						>
							{item}
						</div>
					))}
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

	const markComplete = async () => {
		await setOnboardingCompleted.mutateAsync(true);
	};

	const navigateMainWindow = async (path: string) => {
		await markComplete();
		await emitTo("main", "navigate", path);
		const mainWindow = await WebviewWindow.getByLabel("main");
		await mainWindow?.setFocus();
		await closeWindow();
	};

	const handleSkip = async () => {
		await markComplete();
		await closeWindow();
	};

	return (
		<Surface
			variant="secondary"
			className="flex min-h-screen flex-col overflow-hidden"
			data-onboarding-shell=""
		>
			<div data-tauri-drag-region className="h-6 shrink-0" />

			<div className="relative flex-1 overflow-auto p-4 md:p-6">
				<div
					className="pointer-events-none"
					data-onboarding-backdrop=""
				/>

				<div className="relative mx-auto flex min-h-full w-full max-w-7xl flex-col gap-5">
					<header className="flex flex-wrap items-center justify-between gap-4">
						<div className="flex items-center gap-3">
							<div className="flex size-11 items-center justify-center rounded-2xl border border-accent/30 bg-accent/12 text-accent">
								<SquaresPlusIcon className="size-5" />
							</div>
							<div>
								<p className="text-xs font-semibold tracking-[0.24em] text-muted uppercase">
									aghub
								</p>
								<p className="text-sm text-muted">
									{t("onboardingHeaderSubtitle")}
								</p>
							</div>
						</div>

						<div className="flex items-center gap-3">
							<StepNav
								currentStep={stepIndex}
								onSelect={handleStepChange}
							/>
							<Button
								variant="tertiary"
								onPress={handleSkip}
								isDisabled={setOnboardingCompleted.isPending}
							>
								{t("onboardingSkip")}
							</Button>
						</div>
					</header>

					<div className="grid flex-1 gap-5 xl:grid-cols-[minmax(0,0.86fr)_minmax(480px,1.14fr)]">
						<Card className="border border-border/70 bg-surface/88 p-0">
							<Card.Content className="flex h-full flex-col gap-8 p-6 md:p-8">
								<div className="space-y-5">
									<div className="flex items-center gap-3">
										<span className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-muted uppercase">
											{step.indexLabel}
										</span>
										<span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent">
											{t(step.eyebrowKey)}
										</span>
									</div>

									<div className="space-y-3">
										<h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
											{t(step.titleKey)}
										</h1>
										<p className="max-w-xl text-base leading-8 text-muted md:text-lg">
											{t(step.bodyKey, {
												count: agentCount,
											})}
										</p>
									</div>
								</div>

								<ul className="space-y-4">
									{step.bulletKeys.map((bulletKey) => (
										<StepBullet key={bulletKey}>
											{t(bulletKey)}
										</StepBullet>
									))}
								</ul>

								<div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-6">
									<p className="text-sm text-muted">
										{t("onboardingFooterHint")}
									</p>

									<div className="flex items-center gap-3">
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
												variant="primary"
												onPress={() =>
													navigateMainWindow("/mcp")
												}
												isPending={
													setOnboardingCompleted.isPending
												}
											>
												{t("onboardingPrimaryAction")}
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
							className="min-h-[540px]"
							data-onboarding-stage={direction}
						>
							{step.id === "welcome" && (
								<WelcomeVisual agentCount={agentCount} />
							)}
							{step.id === "mcp" && <McpVisual />}
							{step.id === "skills" && <SkillsVisual />}
							{step.id === "scope" && (
								<ScopeVisual
									onNavigate={navigateMainWindow}
									isPending={setOnboardingCompleted.isPending}
								/>
							)}
						</div>
					</div>
				</div>
			</div>
		</Surface>
	);
}
