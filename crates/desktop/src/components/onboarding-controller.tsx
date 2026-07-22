import { Button, Modal, toast } from "@heroui/react";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOnboardingTours } from "../hooks/use-onboarding-tours";
import { capture } from "../lib/analytics";
import { saveAnalyticsPreference } from "../lib/analytics-preference";
import { ONBOARDING_EVENT, type OnboardingCommand } from "../lib/onboarding";
import {
	buildWizardSteps,
	createWizardState,
	getWizardAcknowledgements,
	onboardingWizardReducer,
	WIZARD_FEATURE_STEPS,
} from "../lib/onboarding-wizard";
import {
	getConsentAcked,
	getAnalyticsConsent,
	getLastSeenWhatsNewVersion,
	getOnboardingProgress,
	setLastSeenWhatsNewVersion,
	updateOnboardingProgress,
} from "../lib/store";
import { pendingWhatsNew } from "../lib/whats-new";
import { OnboardingWizard } from "./onboarding-wizard";

type OverlayMode = "welcome" | null;

export function OnboardingController() {
	const { t } = useTranslation();
	const [isReady, setIsReady] = useState(false);
	const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
	const [analyticsOptIn, setAnalyticsOptIn] = useState(true);
	const [isDismissing, setIsDismissing] = useState(false);
	const [wizard, dispatchWizard] = useReducer(
		onboardingWizardReducer,
		undefined,
		() => createWizardState(),
	);
	const { currentStep, steps: wizardSteps } = wizard;
	const includedFeatureSteps = wizardSteps.some(
		(step) => step.type === "feature",
	);
	const activeStep = wizardSteps[currentStep];
	const dismissInFlightRef = useRef(false);
	const currentVersionRef = useRef<string | null>(null);
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
			if (acknowledgements.consentWasSeen) {
				await saveAnalyticsPreference(analyticsOptIn);
			}

			const lastSeenVersion =
				acknowledgements.latestWhatsNewVersion ??
				(includedFeatureSteps ? currentVersionRef.current : null);
			if (lastSeenVersion) {
				await setLastSeenWhatsNewVersion(lastSeenVersion);
			}

			await updateOnboardingProgress({ hasSeenWelcome: true });
			capture("onboarding completed");
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
		let isMounted = true;

		void (async () => {
			const [progress, consentAcked, consent, lastSeen, version] =
				await Promise.all([
					getOnboardingProgress(),
					getConsentAcked(),
					getAnalyticsConsent(),
					getLastSeenWhatsNewVersion(),
					getVersion(),
				]);
			if (!isMounted) return;

			const whatsNewEntries = pendingWhatsNew(lastSeen, version);
			const steps = buildWizardSteps({
				hasSeenWelcome: progress.hasSeenWelcome,
				consentAcked,
				whatsNewEntries,
			});

			if (!isMounted) return;

			currentVersionRef.current = version;
			setAnalyticsOptIn(consent === "granted");
			setIsReady(true);

			if (steps.length > 0) {
				dispatchWizard({ type: "open", steps });
				setOverlayMode("welcome");
			}
		})();

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		const listener = (event: Event) => {
			handleCommand((event as CustomEvent<OnboardingCommand>).detail);
		};

		window.addEventListener(ONBOARDING_EVENT, listener);

		return () => {
			window.removeEventListener(ONBOARDING_EVENT, listener);
		};
	}, []);

	if (!isReady) {
		return null;
	}

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
								{t("onboardingWizardTitle")}
							</Modal.Heading>
							<p className="text-sm text-muted">
								{t("onboardingWizardSubtitle")}
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
