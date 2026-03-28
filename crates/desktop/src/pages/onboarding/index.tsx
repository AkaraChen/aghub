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
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useSetOnboardingCompleted } from "../../hooks/use-onboarding";
import "../../styles/onboarding.css";

const appIconUrl = new URL(
	"../../../src-tauri/icons/128x128.png",
	import.meta.url,
).href;

function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<span className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent">
			{children}
		</span>
	);
}

function SectionDivider() {
	return <div className="h-px bg-border/70" />;
}

function StepBullet({ children }: { children: React.ReactNode }) {
	return (
		<li className="flex items-start gap-3 text-sm leading-6 text-foreground">
			<span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
				<CheckBadgeIcon className="size-3.5" />
			</span>
			<span>{children}</span>
		</li>
	);
}

function SectionIntro({
	eyebrow,
	title,
	body,
	bullets,
	hero = false,
}: {
	eyebrow: string;
	title: string;
	body: string;
	bullets: string[];
	hero?: boolean;
}) {
	return (
		<div className="space-y-5">
			<div className="space-y-4">
				<SectionLabel>{eyebrow}</SectionLabel>

				<div className="space-y-3">
					{hero ? (
						<h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
							{title}
						</h1>
					) : (
						<h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
							{title}
						</h2>
					)}

					<p className="max-w-3xl text-base leading-8 text-muted md:text-lg">
						{body}
					</p>
				</div>
			</div>

			<ul className="space-y-3">
				{bullets.map((bullet) => (
					<StepBullet key={bullet}>{bullet}</StepBullet>
				))}
			</ul>
		</div>
	);
}

function FeatureRow({
	icon,
	title,
	description,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
}) {
	return (
		<div className="flex items-start gap-3 rounded-2xl bg-surface-secondary/90 p-4">
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
		<div className="flex items-start gap-3 rounded-2xl bg-surface-secondary/90 p-4">
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
		<div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-secondary/90 px-4 py-3">
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
		<div className="flex h-full flex-col gap-4 rounded-2xl bg-surface-secondary/90 p-4">
			<div className="flex items-start gap-3">
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
				className="mt-auto justify-between"
				isDisabled={isPending}
				onPress={onPress}
			>
				<span>{buttonLabel}</span>
				<ArrowRightIcon className="size-4" />
			</Button>
		</div>
	);
}

function WelcomeSection({ agentCount }: { agentCount: number }) {
	const { t } = useTranslation();

	return (
		<section className="space-y-6 px-6 py-7 md:px-8 md:py-8">
			<SectionIntro
				eyebrow={t("onboardingWelcomeEyebrow")}
				title={t("onboardingWelcomeTitle")}
				body={t("onboardingWelcomeBody")}
				bullets={[
					t("onboardingWelcomeBulletOne"),
					t("onboardingWelcomeBulletTwo"),
				]}
				hero
			/>

			<div className="space-y-4 rounded-2xl bg-surface-secondary/90 p-4">
				<div className="flex items-center gap-4">
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

				<div className="grid gap-3 md:grid-cols-3">
					<FeatureRow
						icon={<ServerStackIcon className="size-4" />}
						title={t("onboardingFeatureMcpTitle")}
						description={t("onboardingFeatureMcpDescription")}
					/>
					<FeatureRow
						icon={<BookOpenIcon className="size-4" />}
						title={t("onboardingFeatureSkillsTitle")}
						description={t("onboardingFeatureSkillsDescription")}
					/>
					<FeatureRow
						icon={<FolderIcon className="size-4" />}
						title={t("onboardingFeatureScopeTitle")}
						description={t("onboardingFeatureScopeDescription")}
					/>
				</div>
			</div>
		</section>
	);
}

function McpSection() {
	const { t } = useTranslation();

	return (
		<section className="space-y-6 px-6 py-7 md:px-8 md:py-8">
			<SectionIntro
				eyebrow={t("onboardingMcpEyebrow")}
				title={t("onboardingMcpTitle")}
				body={t("onboardingMcpBody")}
				bullets={[
					t("onboardingMcpBulletOne"),
					t("onboardingMcpBulletTwo"),
				]}
			/>

			<div className="space-y-3">
				<div className="rounded-2xl bg-surface-secondary/90 p-4">
					<p className="text-xs font-semibold tracking-[0.18em] text-muted uppercase">
						{t("onboardingMcpVisualTitle")}
					</p>
					<p className="mt-1 text-sm leading-6 text-muted">
						{t("onboardingMcpVisualBody")}
					</p>
				</div>

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
		</section>
	);
}

function SkillsSection() {
	const { t } = useTranslation();

	return (
		<section className="space-y-6 px-6 py-7 md:px-8 md:py-8">
			<SectionIntro
				eyebrow={t("onboardingSkillsEyebrow")}
				title={t("onboardingSkillsTitle")}
				body={t("onboardingSkillsBody")}
				bullets={[
					t("onboardingSkillsBulletOne"),
					t("onboardingSkillsBulletTwo"),
				]}
			/>

			<div className="space-y-3">
				<div className="rounded-2xl bg-surface-secondary/90 p-4">
					<p className="text-xs font-semibold tracking-[0.18em] text-muted uppercase">
						{t("onboardingSkillsVisualTitle")}
					</p>
					<p className="mt-1 text-sm leading-6 text-muted">
						{t("onboardingSkillsVisualBody")}
					</p>
				</div>

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
		</section>
	);
}

function StartSection({
	onNavigate,
	isPending,
}: {
	onNavigate: (path: string) => void;
	isPending: boolean;
}) {
	const { t } = useTranslation();

	return (
		<section className="space-y-6 px-6 py-7 md:px-8 md:py-8">
			<SectionIntro
				eyebrow={t("onboardingStartEyebrow")}
				title={t("onboardingStartTitle")}
				body={t("onboardingStartBody")}
				bullets={[
					t("onboardingStartBulletOne"),
					t("onboardingStartBulletTwo"),
				]}
			/>

			<div className="rounded-2xl bg-surface-secondary/90 p-4">
				<p className="text-sm font-semibold text-foreground">
					{t("onboardingNextStepTitle")}
				</p>
				<p className="mt-1 text-sm leading-6 text-muted">
					{t("onboardingNextStepBody")}
				</p>
			</div>

			<div className="grid gap-3 md:grid-cols-3">
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
		</section>
	);
}

export default function OnboardingPage() {
	const { t } = useTranslation();
	const { allAgents } = useAgentAvailability();
	const setOnboardingCompleted = useSetOnboardingCompleted();
	const agentCount = allAgents.length || 25;

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

			<div className="relative flex-1 overflow-auto p-4 md:p-6">
				<div
					className="pointer-events-none"
					data-onboarding-backdrop=""
				/>

				<div className="relative mx-auto flex w-full max-w-4xl flex-col gap-4">
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

						<Button
							variant="tertiary"
							onPress={() => void finishOnboarding()}
							isDisabled={setOnboardingCompleted.isPending}
						>
							{t("onboardingSkip")}
						</Button>
					</header>

					<Card className="overflow-hidden border border-border/70 bg-surface/88 p-0">
						<Card.Content className="p-0">
							<WelcomeSection agentCount={agentCount} />
							<SectionDivider />
							<McpSection />
							<SectionDivider />
							<SkillsSection />
							<SectionDivider />
							<StartSection
								onNavigate={navigateMainWindow}
								isPending={setOnboardingCompleted.isPending}
							/>
						</Card.Content>
					</Card>

					<div className="flex justify-end">
						<Button
							variant="tertiary"
							onPress={() => void finishOnboarding()}
							isDisabled={setOnboardingCompleted.isPending}
						>
							{t("onboardingMaybeLater")}
						</Button>
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
