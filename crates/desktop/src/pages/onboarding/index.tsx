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
		<span className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
			{children}
		</span>
	);
}

function StepBullet({ children }: { children: React.ReactNode }) {
	return (
		<li className="flex items-start gap-3 text-sm leading-7 text-foreground/80">
			<span className="mt-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
				<CheckBadgeIcon className="size-3.5" />
			</span>
			<span>{children}</span>
		</li>
	);
}

function WelcomeSection({ agentCount }: { agentCount: number }) {
	const { t } = useTranslation();

	return (
		<section className="px-8 py-10">
			<div className="mb-10 max-w-2xl space-y-5">
				<SectionLabel>{t("onboardingWelcomeEyebrow")}</SectionLabel>
				<h1 className="text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
					{t("onboardingWelcomeTitle")}
				</h1>
				<p className="text-lg leading-8 text-muted">
					{t("onboardingWelcomeBody")}
				</p>

				<ul className="space-y-2 pt-2">
					<StepBullet>{t("onboardingWelcomeBulletOne")}</StepBullet>
					<StepBullet>{t("onboardingWelcomeBulletTwo")}</StepBullet>
				</ul>
			</div>

			<div className="rounded-3xl border border-border/50 bg-gradient-to-br from-surface-secondary/80 to-surface-secondary/40 p-6">
				<div className="mb-6 flex items-center gap-4">
					<img
						src={appIconUrl}
						alt=""
						className="size-14 rounded-2xl border border-border/70 shadow-sm"
					/>
					<div>
						<p className="text-base font-semibold text-foreground">
							{t("onboardingOverviewTitle")}
						</p>
						<p className="text-sm text-muted">
							{t("onboardingAgentCoverage", {
								count: agentCount,
							})}
						</p>
					</div>
				</div>

				<p className="mb-6 text-sm leading-7 text-muted">
					{t("onboardingOverviewBody")}
				</p>

				<div className="grid gap-4 sm:grid-cols-3">
					<div className="rounded-2xl border border-border/40 bg-surface/60 p-5">
						<div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
							<ServerStackIcon className="size-5" />
						</div>
						<p className="mb-1 text-sm font-semibold text-foreground">
							{t("onboardingFeatureMcpTitle")}
						</p>
						<p className="text-sm leading-6 text-muted">
							{t("onboardingFeatureMcpDescription")}
						</p>
					</div>
					<div className="rounded-2xl border border-border/40 bg-surface/60 p-5">
						<div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
							<BookOpenIcon className="size-5" />
						</div>
						<p className="mb-1 text-sm font-semibold text-foreground">
							{t("onboardingFeatureSkillsTitle")}
						</p>
						<p className="text-sm leading-6 text-muted">
							{t("onboardingFeatureSkillsDescription")}
						</p>
					</div>
					<div className="rounded-2xl border border-border/40 bg-surface/60 p-5">
						<div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
							<FolderIcon className="size-5" />
						</div>
						<p className="mb-1 text-sm font-semibold text-foreground">
							{t("onboardingFeatureScopeTitle")}
						</p>
						<p className="text-sm leading-6 text-muted">
							{t("onboardingFeatureScopeDescription")}
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}

function McpSection() {
	const { t } = useTranslation();

	return (
		<section className="border-t border-border/50 bg-surface-secondary/30 px-8 py-10">
			<div className="mb-8 max-w-2xl space-y-5">
				<SectionLabel>{t("onboardingMcpEyebrow")}</SectionLabel>
				<h2 className="text-3xl font-semibold tracking-tight text-foreground">
					{t("onboardingMcpTitle")}
				</h2>
				<p className="text-base leading-7 text-muted">
					{t("onboardingMcpBody")}
				</p>

				<ul className="space-y-2 pt-1">
					<StepBullet>{t("onboardingMcpBulletOne")}</StepBullet>
					<StepBullet>{t("onboardingMcpBulletTwo")}</StepBullet>
				</ul>
			</div>

			<div className="mb-5 rounded-2xl border border-accent/20 bg-accent/5 px-5 py-4">
				<p className="text-xs font-semibold tracking-widest text-accent uppercase">
					{t("onboardingMcpVisualTitle")}
				</p>
				<p className="mt-1 text-sm leading-6 text-muted">
					{t("onboardingMcpVisualBody")}
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-3">
				{[
					{
						index: "01",
						title: t("onboardingMcpFlowOneTitle"),
						desc: t("onboardingMcpFlowOneBody"),
					},
					{
						index: "02",
						title: t("onboardingMcpFlowTwoTitle"),
						desc: t("onboardingMcpFlowTwoBody"),
					},
					{
						index: "03",
						title: t("onboardingMcpFlowThreeTitle"),
						desc: t("onboardingMcpFlowThreeBody"),
					},
				].map((step, i) => (
					<div
						key={step.index}
						className="relative rounded-2xl border border-border/50 bg-surface/70 p-5"
					>
						<div className="mb-3 flex size-9 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-sm font-semibold text-accent">
							{step.index}
						</div>
						<p className="mb-1 text-sm font-semibold text-foreground">
							{step.title}
						</p>
						<p className="text-sm leading-6 text-muted">
							{step.desc}
						</p>
						{i < 2 && (
							<div className="pointer-events-none absolute -right-3 top-1/2 hidden text-border/70 sm:block">
								<ArrowRightIcon className="size-5" />
							</div>
						)}
					</div>
				))}
			</div>
		</section>
	);
}

function SkillsSection() {
	const { t } = useTranslation();

	return (
		<section className="border-t border-border/50 px-8 py-10">
			<div className="mb-8 max-w-2xl space-y-5">
				<SectionLabel>{t("onboardingSkillsEyebrow")}</SectionLabel>
				<h2 className="text-3xl font-semibold tracking-tight text-foreground">
					{t("onboardingSkillsTitle")}
				</h2>
				<p className="text-base leading-7 text-muted">
					{t("onboardingSkillsBody")}
				</p>

				<ul className="space-y-2 pt-1">
					<StepBullet>{t("onboardingSkillsBulletOne")}</StepBullet>
					<StepBullet>{t("onboardingSkillsBulletTwo")}</StepBullet>
				</ul>
			</div>

			<div className="mb-5 rounded-2xl border border-accent/20 bg-accent/5 px-5 py-4">
				<p className="text-xs font-semibold tracking-widest text-accent uppercase">
					{t("onboardingSkillsVisualTitle")}
				</p>
				<p className="mt-1 text-sm leading-6 text-muted">
					{t("onboardingSkillsVisualBody")}
				</p>
			</div>

			<div className="space-y-3">
				{[
					{
						name: "review-pr",
						desc: t("onboardingSkillExampleReview"),
					},
					{ name: "fix-ci", desc: t("onboardingSkillExampleCi") },
					{
						name: "ship-feature",
						desc: t("onboardingSkillExampleShip"),
					},
				].map((skill) => (
					<div
						key={skill.name}
						className="flex items-center justify-between gap-4 rounded-2xl border border-border/50 bg-surface/70 px-5 py-4"
					>
						<div className="min-w-0">
							<p className="font-mono text-sm font-medium text-foreground">
								{skill.name}
							</p>
							<p className="mt-0.5 text-sm leading-6 text-muted">
								{skill.desc}
							</p>
						</div>
						<span className="shrink-0 rounded-full border border-border/70 bg-surface-secondary/80 px-3 py-1 font-mono text-[11px] text-muted">
							SKILL.md
						</span>
					</div>
				))}
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
		<section className="border-t border-border/50 bg-gradient-to-b from-surface-secondary/50 to-transparent px-8 py-10">
			<div className="mb-8 max-w-2xl space-y-5">
				<SectionLabel>{t("onboardingStartEyebrow")}</SectionLabel>
				<h2 className="text-3xl font-semibold tracking-tight text-foreground">
					{t("onboardingStartTitle")}
				</h2>
				<p className="text-base leading-7 text-muted">
					{t("onboardingStartBody")}
				</p>

				<ul className="space-y-2 pt-1">
					<StepBullet>{t("onboardingStartBulletOne")}</StepBullet>
					<StepBullet>{t("onboardingStartBulletTwo")}</StepBullet>
				</ul>
			</div>

			<div className="mb-6 rounded-2xl border border-border/50 bg-surface/70 p-5">
				<p className="text-sm font-semibold text-foreground">
					{t("onboardingNextStepTitle")}
				</p>
				<p className="mt-1 text-sm leading-6 text-muted">
					{t("onboardingNextStepBody")}
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-3">
				<div className="flex flex-col gap-4 rounded-2xl border border-border/50 bg-surface/70 p-5">
					<div className="flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
						<ServerStackIcon className="size-5" />
					</div>
					<div>
						<p className="text-sm font-semibold text-foreground">
							{t("onboardingStartMcpTitle")}
						</p>
						<p className="mt-1 text-sm leading-6 text-muted">
							{t("onboardingStartMcpBody")}
						</p>
					</div>
					<Button
						variant="secondary"
						className="mt-auto justify-between"
						isDisabled={isPending}
						onPress={() => onNavigate("/mcp")}
					>
						<span>{t("onboardingStartMcpCta")}</span>
						<ArrowRightIcon className="size-4" />
					</Button>
				</div>
				<div className="flex flex-col gap-4 rounded-2xl border border-border/50 bg-surface/70 p-5">
					<div className="flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
						<BookOpenIcon className="size-5" />
					</div>
					<div>
						<p className="text-sm font-semibold text-foreground">
							{t("onboardingStartSkillsTitle")}
						</p>
						<p className="mt-1 text-sm leading-6 text-muted">
							{t("onboardingStartSkillsBody")}
						</p>
					</div>
					<Button
						variant="secondary"
						className="mt-auto justify-between"
						isDisabled={isPending}
						onPress={() => onNavigate("/skills")}
					>
						<span>{t("onboardingStartSkillsCta")}</span>
						<ArrowRightIcon className="size-4" />
					</Button>
				</div>
				<div className="flex flex-col gap-4 rounded-2xl border border-border/50 bg-surface/70 p-5">
					<div className="flex size-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
						<SquaresPlusIcon className="size-5" />
					</div>
					<div>
						<p className="text-sm font-semibold text-foreground">
							{t("onboardingStartMarketTitle")}
						</p>
						<p className="mt-1 text-sm leading-6 text-muted">
							{t("onboardingStartMarketBody")}
						</p>
					</div>
					<Button
						variant="secondary"
						className="mt-auto justify-between"
						isDisabled={isPending}
						onPress={() => onNavigate("/skills-sh")}
					>
						<span>{t("onboardingStartMarketCta")}</span>
						<ArrowRightIcon className="size-4" />
					</Button>
				</div>
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
			<div data-tauri-drag-region className="h-7 shrink-0" />

			<div className="relative flex-1 overflow-auto px-4 pb-6 pt-4 md:px-6">
				<div
					className="pointer-events-none"
					data-onboarding-backdrop=""
				/>

				<div className="relative mx-auto flex w-full max-w-4xl flex-col gap-5">
					<header className="flex items-center justify-between rounded-2xl border border-border/40 bg-surface/60 px-5 py-3">
						<div className="flex items-center gap-3">
							<img
								src={appIconUrl}
								alt=""
								className="size-10 rounded-xl border border-border/60"
							/>
							<p className="text-sm font-medium text-foreground">
								{t("onboardingHeaderSubtitle")}
							</p>
						</div>

						<Button
							variant="tertiary"
							size="sm"
							onPress={() => void finishOnboarding()}
							isDisabled={setOnboardingCompleted.isPending}
						>
							{t("onboardingSkip")}
						</Button>
					</header>

					<Card className="overflow-hidden border border-border/50 bg-surface/90">
						<Card.Content className="p-0">
							<WelcomeSection agentCount={agentCount} />
							<McpSection />
							<SkillsSection />
							<StartSection
								onNavigate={navigateMainWindow}
								isPending={setOnboardingCompleted.isPending}
							/>
						</Card.Content>
					</Card>

					{setOnboardingCompleted.isPending && (
						<p className="text-center text-sm text-muted">
							{t("onboardingSavingProgress")}
						</p>
					)}
				</div>
			</div>
		</Surface>
	);
}
