import { isHTTPError } from "ky";
import type { AuditReportDto } from "../generated/dto";

export type AuditDisposition =
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

export type AuditedMutationErrorKind =
	| "content_changed"
	| "copy_changed"
	| "session_expired"
	| "confirmation_required"
	| "audit_failed"
	| "write_failed";

export interface AuditedMutationError {
	kind: AuditedMutationErrorKind;
	message: string;
}

export type AuditedMutationState<TCandidate, TResult> =
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

export type AuditedMutationEvent<TCandidate, TResult> =
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

function currentRunId<TCandidate, TResult>(
	state: AuditedMutationState<TCandidate, TResult>,
): number | null {
	return "runId" in state ? state.runId : null;
}

function isNewRun<TCandidate, TResult>(
	state: AuditedMutationState<TCandidate, TResult>,
	runId: number,
): boolean {
	const activeRunId = currentRunId(state);
	return activeRunId === null || runId > activeRunId;
}

export function auditedMutationReducer<TCandidate, TResult>(
	state: AuditedMutationState<TCandidate, TResult>,
	event: AuditedMutationEvent<TCandidate, TResult>,
): AuditedMutationState<TCandidate, TResult> {
	if (event.type === "reset") return { tag: "idle" };

	const activeRunId = currentRunId(state);
	if (activeRunId !== null && event.runId < activeRunId) return state;
	const startsNewRun = isNewRun(state, event.runId);

	switch (event.type) {
		case "audit":
			if (
				!startsNewRun &&
				state.tag !== "auditing" &&
				state.tag !== "writing"
			) {
				return state;
			}
			return {
				tag: "auditing",
				runId: event.runId,
				candidate: event.candidate,
			};
		case "review":
			if (
				!startsNewRun &&
				state.tag !== "auditing" &&
				state.tag !== "writing"
			) {
				return state;
			}
			return {
				tag: "review",
				runId: event.runId,
				candidate: event.candidate,
				report: event.report,
				sessionId: event.sessionId,
			};
		case "write":
			if (
				!startsNewRun &&
				state.tag !== "auditing" &&
				state.tag !== "review"
			) {
				return state;
			}
			return {
				tag: "writing",
				runId: event.runId,
				candidate: event.candidate,
				report: event.report,
				sessionId: event.sessionId,
			};
		case "done":
			if (
				startsNewRun ||
				state.tag !== "writing" ||
				state.runId !== event.runId
			) {
				return state;
			}
			return {
				tag: "done",
				runId: event.runId,
				candidate: event.candidate,
				report: event.report,
				sessionId: event.sessionId,
				result: event.result,
			};
		case "fail":
			if (
				startsNewRun ||
				activeRunId !== event.runId ||
				(event.stage === "write" && state.tag !== "writing") ||
				(event.stage === "audit" &&
					state.tag !== "auditing" &&
					state.tag !== "writing")
			) {
				return state;
			}
			return {
				tag: "failed",
				runId: event.runId,
				candidate: event.candidate,
				stage: event.stage,
				error: event.error,
			};
	}
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

export function auditedMutationError(
	error: unknown,
	stage: "audit" | "write",
): AuditedMutationError {
	switch (apiErrorCode(error)) {
		case "SKILL_AUDIT_CONTENT_CHANGED":
			return { kind: "content_changed", message: errorMessage(error) };
		case "SKILL_COPY_CHANGED":
			return { kind: "copy_changed", message: errorMessage(error) };
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

export function requiresFreshAudit(error: AuditedMutationError): boolean {
	return (
		error.kind === "content_changed" ||
		error.kind === "session_expired" ||
		error.kind === "confirmation_required"
	);
}
