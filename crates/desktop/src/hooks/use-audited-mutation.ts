import { useCallback, useEffect, useReducer, useRef } from "react";
import type { AuditReportDto } from "../generated/dto";
import {
	type AuditDisposition,
	type AuditedMutationError,
	auditedMutationError,
	auditedMutationReducer,
	requiresFreshAudit,
} from "./audited-mutation";

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

interface ActiveAuditedMutation<TCandidate, TResult> {
	runId: number;
	candidate: TCandidate;
	controller: AbortController;
	adapter: AuditedMutationAdapter<TCandidate, TResult>;
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
	const activeRef = useRef<ActiveAuditedMutation<TCandidate, TResult> | null>(
		null,
	);
	const nextRunIdRef = useRef(0);
	stateRef.current = state;
	adapterRef.current = adapter;

	const isCurrent = useCallback(
		(run: ActiveAuditedMutation<TCandidate, TResult>) =>
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
			adapter: adapterRef.current,
		};
		nextRunIdRef.current = run.runId;
		activeRef.current = run;
		return run;
	}, []);

	const fail = useCallback(
		(
			run: ActiveAuditedMutation<TCandidate, TResult>,
			error: unknown,
			stage: "audit" | "write",
		) => {
			if (!isCurrent(run)) return;
			run.adapter.onFailure?.(error, stage);
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

	const execute = useCallback(
		async (
			run: ActiveAuditedMutation<TCandidate, TResult>,
			initialDisposition?: AuditDisposition,
			confirmReview = false,
		) => {
			let disposition = initialDisposition;
			let canRecover = true;
			let confirmedAssessmentDigest =
				disposition?.kind === "review" && confirmReview
					? disposition.report.assessment_digest
					: null;

			if (disposition?.kind === "review" && !confirmReview) {
				dispatch({
					type: "review",
					runId: run.runId,
					candidate: run.candidate,
					report: disposition.report,
					sessionId: disposition.sessionId,
				});
				return;
			}

			while (isCurrent(run)) {
				if (!disposition) {
					dispatch({
						type: "audit",
						runId: run.runId,
						candidate: run.candidate,
					});
					try {
						disposition = await run.adapter.audit(
							run.candidate,
							run.controller.signal,
						);
					} catch (error) {
						if (!isCurrent(run)) return;
						const mutationError = auditedMutationError(
							error,
							"audit",
						);
						if (
							canRecover &&
							requiresFreshAudit(mutationError) &&
							run.adapter.recover
						) {
							try {
								run.candidate = await run.adapter.recover(
									run.candidate,
									mutationError,
									run.controller.signal,
								);
							} catch (recoveryError) {
								fail(run, recoveryError, "audit");
								return;
							}
							if (!isCurrent(run)) return;
							canRecover = false;
							continue;
						}
						fail(run, error, "audit");
						return;
					}
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
				}

				dispatch({
					type: "write",
					runId: run.runId,
					candidate: run.candidate,
					report: disposition.report,
					sessionId: disposition.sessionId,
				});
				try {
					const outcome = await run.adapter.write(
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
					return;
				} catch (error) {
					if (!isCurrent(run)) return;
					const mutationError = auditedMutationError(error, "write");
					if (canRecover && requiresFreshAudit(mutationError)) {
						try {
							if (run.adapter.recover) {
								run.candidate = await run.adapter.recover(
									run.candidate,
									mutationError,
									run.controller.signal,
								);
							}
						} catch (recoveryError) {
							fail(run, recoveryError, "audit");
							return;
						}
						if (!isCurrent(run)) return;
						disposition = undefined;
						confirmedAssessmentDigest = null;
						canRecover = false;
						continue;
					}
					fail(run, error, "write");
					return;
				}
			}
		},
		[fail, isCurrent],
	);

	const start = useCallback(
		async (
			candidate: TCandidate,
			disposition?: AuditDisposition,
			confirmReview = false,
		) => {
			await execute(begin(candidate), disposition, confirmReview);
		},
		[begin, execute],
	);

	const confirm = useCallback(async () => {
		const current = stateRef.current;
		if (current.tag !== "review") return;
		await execute(
			begin(current.candidate),
			{
				kind: "review",
				report: current.report,
				sessionId: current.sessionId,
			},
			true,
		);
	}, [begin, execute]);

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
