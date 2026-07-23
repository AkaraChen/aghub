import { isHTTPError } from "ky";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AuditReportDto } from "../generated/dto";

type AuditDisposition =
	| {
			kind: "allow";
			report: AuditReportDto | null;
			sessionId: string | null;
	  }
	| {
			kind: "review";
			report: AuditReportDto;
			sessionId: string | null;
	  };

export function auditDisposition(
	report: AuditReportDto,
	sessionId: string | null,
	serverRequiresConfirmation?: boolean,
): AuditDisposition {
	if (
		serverRequiresConfirmation !== undefined &&
		serverRequiresConfirmation !== report.confirmation_required
	) {
		throw new Error(
			"Skill audit response contains conflicting confirmation requirements",
		);
	}
	if (report.confirmation_required) {
		return { kind: "review", report, sessionId };
	}
	return { kind: "allow", report, sessionId };
}

type AuditedMutationErrorKind =
	| "content_changed"
	| "session_expired"
	| "confirmation_required"
	| "audit_failed"
	| "write_failed";

interface AuditedMutationError {
	kind: AuditedMutationErrorKind;
	message: string;
}

type AuditedMutationState<TCandidate, TResult> =
	| { tag: "idle" }
	| { tag: "auditing"; runId: number; candidate: TCandidate }
	| {
			tag: "review";
			runId: number;
			candidate: TCandidate;
			report: AuditReportDto;
			sessionId: string | null;
	  }
	| {
			tag: "writing";
			runId: number;
			candidate: TCandidate;
			report: AuditReportDto | null;
			sessionId: string | null;
	  }
	| {
			tag: "done";
			runId: number;
			candidate: TCandidate;
			report: AuditReportDto | null;
			sessionId: string | null;
			result: TResult;
	  }
	| {
			tag: "failed";
			runId: number;
			candidate: TCandidate;
			stage: "audit" | "write";
			error: AuditedMutationError;
	  };

type AuditedWriteResult<TResult> =
	| {
			kind: "done";
			result: TResult;
			report: AuditReportDto | null;
			sessionId: string | null;
	  }
	| {
			kind: "review";
			report: AuditReportDto;
			sessionId: string | null;
	  };

interface AuditedMutationWrite<TCandidate> {
	candidate: TCandidate;
	report: AuditReportDto | null;
	sessionId: string | null;
	confirmedAssessmentDigest: string | null;
}

interface AuditedMutationAdapter<TCandidate, TResult> {
	audit: (
		candidate: TCandidate,
		signal: AbortSignal,
	) => Promise<AuditDisposition>;
	write: (
		input: AuditedMutationWrite<TCandidate>,
		signal: AbortSignal,
	) => Promise<AuditedWriteResult<TResult>>;
	recover?: (
		candidate: TCandidate,
		error: AuditedMutationError,
		signal: AbortSignal,
	) => Promise<TCandidate>;
	onFailure?: (error: unknown, stage: "audit" | "write") => void;
}

type AuditedMutationEvent<TCandidate, TResult> =
	| { type: "reset" }
	| { type: "audit"; runId: number; candidate: TCandidate }
	| {
			type: "review";
			runId: number;
			candidate: TCandidate;
			report: AuditReportDto;
			sessionId: string | null;
	  }
	| {
			type: "write";
			runId: number;
			candidate: TCandidate;
			report: AuditReportDto | null;
			sessionId: string | null;
	  }
	| {
			type: "done";
			runId: number;
			candidate: TCandidate;
			report: AuditReportDto | null;
			sessionId: string | null;
			result: TResult;
	  }
	| {
			type: "fail";
			runId: number;
			candidate: TCandidate;
			stage: "audit" | "write";
			error: AuditedMutationError;
	  };

function auditedMutationReducer<TCandidate, TResult>(
	state: AuditedMutationState<TCandidate, TResult>,
	event: AuditedMutationEvent<TCandidate, TResult>,
): AuditedMutationState<TCandidate, TResult> {
	if (event.type === "reset") return { tag: "idle" };
	if ("runId" in state && event.runId < state.runId) return state;
	switch (event.type) {
		case "audit":
			return {
				tag: "auditing",
				runId: event.runId,
				candidate: event.candidate,
			};
		case "review":
			return {
				tag: "review",
				runId: event.runId,
				candidate: event.candidate,
				report: event.report,
				sessionId: event.sessionId,
			};
		case "write":
			return {
				tag: "writing",
				runId: event.runId,
				candidate: event.candidate,
				report: event.report,
				sessionId: event.sessionId,
			};
		case "done":
			return {
				tag: "done",
				runId: event.runId,
				candidate: event.candidate,
				report: event.report,
				sessionId: event.sessionId,
				result: event.result,
			};
		case "fail":
			return {
				tag: "failed",
				runId: event.runId,
				candidate: event.candidate,
				stage: event.stage,
				error: event.error,
			};
	}
}

interface ActiveAuditedMutation<TCandidate> {
	runId: number;
	candidate: TCandidate;
	controller: AbortController;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function apiErrorCode(error: unknown): string | null {
	if (!isHTTPError(error) || !error.data || typeof error.data !== "object") {
		return null;
	}
	const code = (error.data as { code?: unknown }).code;
	return typeof code === "string" ? code : null;
}

function auditedMutationError(
	error: unknown,
	stage: "audit" | "write",
): AuditedMutationError {
	switch (apiErrorCode(error)) {
		case "SKILL_AUDIT_CONTENT_CHANGED":
			return { kind: "content_changed", message: errorMessage(error) };
		case "SESSION_NOT_FOUND":
			return { kind: "session_expired", message: errorMessage(error) };
		case "SKILL_AUDIT_CONFIRMATION_REQUIRED":
			return {
				kind: "confirmation_required",
				message: errorMessage(error),
			};
		default:
			return {
				kind: stage === "audit" ? "audit_failed" : "write_failed",
				message: errorMessage(error),
			};
	}
}

function requiresFreshAudit(error: AuditedMutationError): boolean {
	return (
		error.kind === "content_changed" ||
		error.kind === "session_expired" ||
		error.kind === "confirmation_required"
	);
}

export function useAuditedMutation<TCandidate, TResult>(
	adapter: AuditedMutationAdapter<TCandidate, TResult>,
) {
	const [state, dispatch] = useReducer(
		auditedMutationReducer<TCandidate, TResult>,
		{ tag: "idle" },
	);
	const stateRef = useRef(state);
	const adapterRef = useRef(adapter);
	const activeRef = useRef<ActiveAuditedMutation<TCandidate> | null>(null);
	const nextRunIdRef = useRef(0);
	stateRef.current = state;
	adapterRef.current = adapter;

	const isCurrent = useCallback(
		(run: ActiveAuditedMutation<TCandidate>) =>
			activeRef.current?.runId === run.runId &&
			!run.controller.signal.aborted,
		[],
	);

	const begin = useCallback((candidate: TCandidate) => {
		activeRef.current?.controller.abort();
		const run = {
			runId: nextRunIdRef.current + 1,
			candidate,
			controller: new AbortController(),
		};
		nextRunIdRef.current = run.runId;
		activeRef.current = run;
		return run;
	}, []);

	const runAuditRef = useRef<
		(
			run: ActiveAuditedMutation<TCandidate>,
			allowWriteRetry: boolean,
		) => Promise<void>
	>(async () => undefined);

	const fail = useCallback(
		(
			run: ActiveAuditedMutation<TCandidate>,
			error: unknown,
			stage: "audit" | "write",
		) => {
			if (!isCurrent(run)) return;
			adapterRef.current.onFailure?.(error, stage);
			dispatch({
				type: "fail",
				runId: run.runId,
				candidate: run.candidate,
				stage,
				error: auditedMutationError(error, stage),
			});
		},
		[isCurrent],
	);

	const recover = useCallback(
		async (
			run: ActiveAuditedMutation<TCandidate>,
			error: AuditedMutationError,
		) => {
			const recoverCandidate = adapterRef.current.recover;
			if (!recoverCandidate) return true;
			const candidate = await recoverCandidate(
				run.candidate,
				error,
				run.controller.signal,
			);
			if (!isCurrent(run)) return false;
			run.candidate = candidate;
			return true;
		},
		[isCurrent],
	);

	const runWrite = useCallback(
		async (
			run: ActiveAuditedMutation<TCandidate>,
			disposition: Extract<AuditDisposition, { kind: "allow" }>,
			confirmedAssessmentDigest: string | null,
			allowWriteRetry: boolean,
		) => {
			dispatch({
				type: "write",
				runId: run.runId,
				candidate: run.candidate,
				report: disposition.report,
				sessionId: disposition.sessionId,
			});
			try {
				const outcome = await adapterRef.current.write(
					{
						candidate: run.candidate,
						report: disposition.report,
						sessionId: disposition.sessionId,
						confirmedAssessmentDigest,
					},
					run.controller.signal,
				);
				if (!isCurrent(run)) return;
				if (outcome.kind === "review") {
					dispatch({
						type: "review",
						runId: run.runId,
						candidate: run.candidate,
						report: outcome.report,
						sessionId: outcome.sessionId,
					});
					return;
				}
				dispatch({
					type: "done",
					runId: run.runId,
					candidate: run.candidate,
					report: outcome.report,
					sessionId: outcome.sessionId,
					result: outcome.result,
				});
			} catch (error) {
				if (!isCurrent(run)) return;
				const mutationError = auditedMutationError(error, "write");
				if (allowWriteRetry && requiresFreshAudit(mutationError)) {
					try {
						if (!(await recover(run, mutationError))) return;
						await runAuditRef.current(run, false);
					} catch (recoveryError) {
						fail(run, recoveryError, "audit");
					}
					return;
				}
				fail(run, error, "write");
			}
		},
		[fail, isCurrent, recover],
	);

	const runAudit = useCallback(
		async (
			run: ActiveAuditedMutation<TCandidate>,
			allowWriteRetry: boolean,
		) => {
			dispatch({
				type: "audit",
				runId: run.runId,
				candidate: run.candidate,
			});
			try {
				const disposition = await adapterRef.current.audit(
					run.candidate,
					run.controller.signal,
				);
				if (!isCurrent(run)) return;
				if (disposition.kind === "review") {
					dispatch({
						type: "review",
						runId: run.runId,
						candidate: run.candidate,
						report: disposition.report,
						sessionId: disposition.sessionId,
					});
					return;
				}
				await runWrite(run, disposition, null, allowWriteRetry);
			} catch (error) {
				if (!isCurrent(run)) return;
				const mutationError = auditedMutationError(error, "audit");
				if (
					allowWriteRetry &&
					requiresFreshAudit(mutationError) &&
					adapterRef.current.recover
				) {
					try {
						if (!(await recover(run, mutationError))) return;
						await runAuditRef.current(run, false);
					} catch (recoveryError) {
						fail(run, recoveryError, "audit");
					}
					return;
				}
				fail(run, error, "audit");
			}
		},
		[fail, isCurrent, recover, runWrite],
	);
	runAuditRef.current = runAudit;

	const start = useCallback(
		async (
			candidate: TCandidate,
			disposition?: AuditDisposition,
			confirmReview = false,
		) => {
			const run = begin(candidate);
			if (!disposition) {
				await runAudit(run, true);
				return;
			}
			if (disposition.kind === "review") {
				if (confirmReview) {
					await runWrite(
						run,
						{
							kind: "allow",
							report: disposition.report,
							sessionId: disposition.sessionId,
						},
						disposition.report.assessment_digest,
						true,
					);
					return;
				}
				dispatch({
					type: "review",
					runId: run.runId,
					candidate,
					report: disposition.report,
					sessionId: disposition.sessionId,
				});
				return;
			}
			await runWrite(run, disposition, null, true);
		},
		[begin, runAudit, runWrite],
	);

	const confirm = useCallback(async () => {
		const current = stateRef.current;
		if (current.tag !== "review") return;
		const run = begin(current.candidate);
		await runWrite(
			run,
			{
				kind: "allow",
				report: current.report,
				sessionId: current.sessionId,
			},
			current.report.assessment_digest,
			true,
		);
	}, [begin, runWrite]);

	const reset = useCallback(() => {
		activeRef.current?.controller.abort();
		activeRef.current = null;
		nextRunIdRef.current += 1;
		dispatch({ type: "reset" });
	}, []);

	useEffect(
		() => () => {
			activeRef.current?.controller.abort();
			activeRef.current = null;
			nextRunIdRef.current += 1;
		},
		[],
	);

	return {
		state,
		start,
		confirm,
		reset,
		isBusy: state.tag === "auditing" || state.tag === "writing",
	};
}

export interface AuditedSkillRun<TCandidate> {
	readonly candidate: TCandidate;
	isCurrent: () => boolean;
}

export function useAuditedSkillRun() {
	const generationRef = useRef(0);

	useEffect(
		() => () => {
			generationRef.current += 1;
		},
		[],
	);

	const beginAuditedSkillRun = <TCandidate>(candidate: TCandidate) => {
		const runGeneration = generationRef.current + 1;
		generationRef.current = runGeneration;

		return {
			candidate,
			isCurrent: () => generationRef.current === runGeneration,
		} satisfies AuditedSkillRun<TCandidate>;
	};

	const invalidateAuditedSkillRun = () => {
		generationRef.current += 1;
	};

	return { beginAuditedSkillRun, invalidateAuditedSkillRun };
}
