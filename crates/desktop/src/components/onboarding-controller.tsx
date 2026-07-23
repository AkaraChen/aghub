import { Button, Modal, toast } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnboardingTours } from "../hooks/use-onboarding-tours";
import { applyAnalyticsConsent, capture } from "../lib/analytics";
import { ONBOARDING_EVENT, type OnboardingCommand } from "../lib/onboarding";
import {
	createWizardState,
	getWizardAcknowledgements,
	onboardingWizardReducer,
	WIZARD_FEATURE_STEPS,
} from "../lib/onboarding-wizard";
import { saveOnboardingCompletion } from "../lib/store";
import { resolveWhatsNewLocale } from "../lib/whats-new";
import {
	type OnboardingBootstrap,
	onboardingBootstrapQueryOptions,
} from "../requests/onboarding";
import { OnboardingWizard } from "./onboarding-wizard";

type OverlayMode = "welcome" | null;

export function OnboardingController() {
	const { t } = useTranslation();
	const bootstrapQuery = useQuery(onboardingBootstrapQueryOptions());
	const reportedBootstrapErrorRef = useRef(false);

	useEffect(() => {
		if (!bootstrapQuery.error || reportedBootstrapErrorRef.current) {
			return;
		}

		reportedBootstrapErrorRef.current = true;
		console.error(
			"Failed to load onboarding progress:",
			bootstrapQuery.error,
		);
		toast.danger(t("onboardingLoadError"));
	}, [bootstrapQuery.error, t]);

	if (bootstrapQuery.isPending) {
		return null;
	}

	return (
		<OnboardingControllerContent
			bootstrap={
				bootstrapQuery.data ?? {
					analyticsOptIn: true,
					steps: [],
					versionToAcknowledge: null,
				}
			}
		/>
	);
}

function OnboardingControllerContent({
	bootstrap,
}: {
	bootstrap: OnboardingBootstrap;
}) {
	const { i18n, t } = useTranslation();
	const [overlayMode, setOverlayMode] = useState<OverlayMode>(() =>
		bootstrap.steps.length > 0 ? "welcome" : null,
	);
	const [analyticsOptIn, setAnalyticsOptIn] = useState(
		bootstrap.analyticsOptIn,
	);
	const [isDismissing, setIsDismissing] = useState(false);
	const [wizard, dispatchWizard] = useReducer(
		onboardingWizardReducer,
		bootstrap,
		(value) => createWizardState(value.steps, value.versionToAcknowledge),
	);
	const { currentStep, steps: wizardSteps } = wizard;
	const includedFeatureSteps = wizardSteps.some(
		(step) => step.type === "feature",
	);
	const includesWhatsNew = wizardSteps.some(
		(step) => step.type === "whats-new",
	);
	const activeStep = wizardSteps[currentStep];
	const dismissInFlightRef = useRef(false);
	const {
		destroyActiveTour,
		startProductTour,
		startProjectSetupGuide,
		startProjectWorkflowTour,
	} = useOnboardingTours(() => setOverlayMode(null));

	const dismissWelcome = async (): Promise<boolean> => {
		if (dismissInFlightRef.current) return false;

		dismissInFlightRef.current = true;
		setIsDismissing(true);
		const acknowledgements = getWizardAcknowledgements(wizard);

		try {
			await saveOnboardingCompletion({
				analyticsConsent: acknowledgements.consentWasSeen
					? analyticsOptIn
						? "granted"
						: "denied"
					: null,
				lastSeenWhatsNewVersion: acknowledgements.latestWhatsNewVersion,
			});
			if (acknowledgements.consentWasSeen) {
				try {
					await applyAnalyticsConsent(analyticsOptIn);
				} catch (error) {
					console.error(
						"Failed to apply analytics preference:",
						error,
					);
				}
			}
			if (includedFeatureSteps) {
				capture("onboarding completed");
			}
			setOverlayMode(null);
			dispatchWizard({ type: "reset" });
			return true;
		} catch (error) {
			console.error("Failed to save onboarding progress:", error);
			toast.danger(t("onboardingSaveError"));
			return false;
		} finally {
			dismissInFlightRef.current = false;
			setIsDismissing(false);
		}
	};

	const finishWelcome = async () => {
		const dismissed = await dismissWelcome();
		if (dismissed && includedFeatureSteps) {
			await startProductTour();
		}
	};

	const handleCommand = useEffectEvent((command: OnboardingCommand) => {
		if (command.type === "show-welcome") {
			destroyActiveTour();
			dispatchWizard({
				type: "open",
				steps: [...WIZARD_FEATURE_STEPS],
				versionToAcknowledge: null,
			});
			setOverlayMode("welcome");
			return;
		}

		if (command.tour === "product-map") {
			void startProductTour();
			return;
		}

		if (command.tour === "project-workflow") {
			void startProjectWorkflowTour();
			return;
		}

		void startProjectSetupGuide();
	});

	useEffect(() => {
		const listener = (event: Event) => {
			handleCommand((event as CustomEvent<OnboardingCommand>).detail);
		};

		window.addEventListener(ONBOARDING_EVENT, listener);

		return () => {
			window.removeEventListener(ONBOARDING_EVENT, listener);
		};
	}, []);

	return (
		<Modal.Backdrop
			isOpen={overlayMode === "welcome"}
			onOpenChange={(isOpen) => {
				if (!isOpen && !dismissInFlightRef.current) {
					void dismissWelcome();
				}
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="w-[calc(100vw-3rem)] max-w-4xl">
					<Modal.CloseTrigger isDisabled={isDismissing} />
					<Modal.Header>
						<div className="space-y-1">
							<Modal.Heading>
								{includesWhatsNew
									? t("whatsNewWizardTitle")
									: t("onboardingWizardTitle")}
							</Modal.Heading>
							<p className="text-sm text-muted">
								{includesWhatsNew
									? t("whatsNewWizardSubtitle")
									: t("onboardingWizardSubtitle")}
							</p>
						</div>
					</Modal.Header>

					<Modal.Body className="space-y-5 px-6 pb-2 pt-0">
						{activeStep && (
							<OnboardingWizard
								step={activeStep}
								steps={wizardSteps}
								currentStep={currentStep}
								onSelectStep={(step) =>
									dispatchWizard({ type: "select", step })
								}
								analyticsOptIn={analyticsOptIn}
								onAnalyticsOptInChange={setAnalyticsOptIn}
								whatsNewLocale={resolveWhatsNewLocale(
									i18n.resolvedLanguage ?? i18n.language,
								)}
								t={t}
							/>
						)}
					</Modal.Body>

					<Modal.Footer>
						<Button
							variant="outline"
							className="flex-1"
							isDisabled={currentStep === 0 || isDismissing}
							onPress={() => dispatchWizard({ type: "previous" })}
						>
							{t("onboardingBack")}
						</Button>

						{currentStep < wizardSteps.length - 1 ? (
							<Button
								variant="primary"
								className="flex-1"
								isDisabled={isDismissing}
								onPress={() => dispatchWizard({ type: "next" })}
							>
								{t("onboardingNext")}
							</Button>
						) : (
							<Button
								variant="primary"
								className="flex-1"
								isPending={isDismissing}
								onPress={() => void finishWelcome()}
							>
								{includedFeatureSteps
									? t("onboardingGetStarted")
									: t("onboardingFinish")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
