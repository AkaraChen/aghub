import { describe, expect, it } from "vitest";
import type { AuditReportDto } from "../generated/dto";
import {
	auditDisposition,
	type AuditedMutationEvent,
	auditedMutationReducer,
	type AuditedMutationState,
} from "./audited-mutation";

const report: AuditReportDto = {
	verdict: "malicious",
	confidence: "high",
	findings: [],
	summary: "Blocked",
	engine_version: "test",
	content_digest: "content",
	assessment_digest: "assessment",
	confirmation_required: true,
};

type State = AuditedMutationState<string, boolean>;
type Event = AuditedMutationEvent<string, boolean>;

function reduce(state: State, event: Event): State {
	return auditedMutationReducer(state, event);
}

describe("auditedMutationReducer", () => {
	it("accepts the audit, review, write, and done sequence", () => {
		const auditing = reduce(
			{ tag: "idle" },
			{ type: "audit", runId: 1, candidate: "first" },
		);
		const review = reduce(auditing, {
			type: "review",
			runId: 1,
			candidate: "first",
			report,
			sessionId: "session",
		});
		const writing = reduce(review, {
			type: "write",
			runId: 1,
			candidate: "first",
			report,
			sessionId: "session",
		});
		const done = reduce(writing, {
			type: "done",
			runId: 1,
			candidate: "first",
			report,
			sessionId: "session",
			result: true,
		});

		expect(done).toMatchObject({
			tag: "done",
			runId: 1,
			candidate: "first",
			result: true,
		});
	});

	it("ignores terminal events that did not follow a write", () => {
		const review = reduce(
			{ tag: "idle" },
			{
				type: "review",
				runId: 1,
				candidate: "first",
				report,
				sessionId: null,
			},
		);
		const invalidDone = reduce(review, {
			type: "done",
			runId: 1,
			candidate: "first",
			report,
			sessionId: null,
			result: true,
		});

		expect(invalidDone).toBe(review);
	});

	it("ignores stale events after a newer run starts", () => {
		const secondRun = reduce(
			{
				tag: "writing",
				runId: 1,
				candidate: "first",
				report,
				sessionId: null,
			},
			{ type: "audit", runId: 2, candidate: "second" },
		);
		const staleFailure = reduce(secondRun, {
			type: "fail",
			runId: 1,
			candidate: "first",
			stage: "write",
			error: { kind: "write_failed", message: "late" },
		});

		expect(staleFailure).toBe(secondRun);
	});

	it("does not revive a reset run with a late completion", () => {
		const reset = reduce(
			{
				tag: "writing",
				runId: 1,
				candidate: "first",
				report,
				sessionId: null,
			},
			{ type: "reset" },
		);
		const lateDone = reduce(reset, {
			type: "done",
			runId: 1,
			candidate: "first",
			report,
			sessionId: null,
			result: true,
		});

		expect(lateDone).toEqual({ tag: "idle" });
	});
});

describe("auditDisposition", () => {
	it("requires review when the report requires confirmation", () => {
		expect(auditDisposition(report, "session")).toEqual({
			kind: "review",
			report,
			sessionId: "session",
		});
	});

	it("rejects conflicting server confirmation metadata", () => {
		expect(() => auditDisposition(report, null, false)).toThrow(
			"conflicting confirmation requirements",
		);
	});
});
