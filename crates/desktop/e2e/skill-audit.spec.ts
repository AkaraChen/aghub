import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { installMocks } from "./mocks";

const REVIEW_DIGEST = "a".repeat(64);
const REVIEW_ASSESSMENT_DIGEST = "c".repeat(64);

const suspiciousAudit = {
	verdict: "suspicious" as const,
	confidence: "high" as const,
	findings: [
		{
			rule_id: "shell-download",
			category: "command_injection" as const,
			severity: "high" as const,
			file: "SKILL.md",
			line: 12,
			evidence: "Downloads and executes a shell script",
			source: "yara" as const,
		},
	],
	summary: "Review before installing",
	engine_version: "e2e",
	content_digest: REVIEW_DIGEST,
	assessment_digest: REVIEW_ASSESSMENT_DIGEST,
	confirmation_required: true,
};

const benignAudit = {
	verdict: "benign" as const,
	confidence: "high" as const,
	findings: [],
	summary: "No unsafe behavior found",
	engine_version: "e2e",
	content_digest: "b".repeat(64),
	assessment_digest: "d".repeat(64),
	confirmation_required: false,
};

const allowedSuspiciousAudit = {
	...suspiciousAudit,
	content_digest: "e".repeat(64),
	assessment_digest: "f".repeat(64),
	confirmation_required: false,
};

async function openAlphaPackUpdate(page: Page) {
	await page.goto("/skills");
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await page.getByRole("button", { name: "Update from source" }).click();
}

test("a grouped skill is audited across every installed path", async ({
	page,
}) => {
	await installMocks(page);
	const auditRequest = page.waitForRequest((request) => {
		if (!request.url().endsWith("/api/v1/skills/audit")) return false;
		const body = request.postDataJSON() as { paths?: string[] };
		return body.paths?.some((path) => path.includes("react-pro")) ?? false;
	});

	await page.goto("/skills");
	const request = await auditRequest;
	const body = request.postDataJSON() as { paths: string[] };

	expect(body.paths).toEqual(
		[
			"/tmp/e2e/.claude/skills/react-pro",
			"/tmp/e2e/.cursor/skills/react-pro",
		].sort(),
	);
	await expect(
		page.getByRole("option", { name: "react-pro", selected: true }),
	).toBeVisible();
});

test("trust is invalidated when the same skill returns a new content digest", async ({
	page,
}) => {
	await installMocks(page);
	let contentDigest = "c".repeat(64);
	const auditedDigests: string[] = [];
	await page.route(
		"http://localhost:45999/api/v1/skills/audit",
		async (route) => {
			const body = route.request().postDataJSON() as { paths?: string[] };
			if (body.paths?.some((path) => path.includes("react-pro"))) {
				auditedDigests.push(contentDigest);
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					...suspiciousAudit,
					content_digest: contentDigest,
					assessment_digest: contentDigest,
				}),
			});
		},
	);

	await page.goto("/skills");
	const trustButton = page.getByRole("button", {
		name: "Trust this skill",
	});
	await expect(trustButton).toBeVisible();
	const detailCard = trustButton.locator(
		"xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]",
	);
	await expect(detailCard.locator(".card.card--transparent")).toHaveCount(1);
	await expect(detailCard.locator(".card.card--secondary")).toHaveCount(0);
	await trustButton.click();
	await expect(
		page.getByText("You trusted this skill — audit warnings are hidden"),
	).toBeVisible();

	const auditCount = auditedDigests.length;
	contentDigest = "d".repeat(64);
	await page.getByRole("button", { name: "Refresh skills" }).click();
	await expect.poll(() => auditedDigests.length).toBeGreaterThan(auditCount);
	await expect(trustButton).toBeVisible();
	await expect(
		page.getByText("You trusted this skill — audit warnings are hidden"),
	).toBeHidden();
	expect(auditedDigests.at(-1)).toBe(contentDigest);
});

test("a non-benign Git import confirms the audited content digest without nesting a second surface", async ({
	page,
}) => {
	await installMocks(page);
	const requests: Array<Record<string, unknown>> = [];
	await page.route(
		"http://localhost:45999/api/v1/skills/git/install",
		async (route) => {
			const body = route.request().postDataJSON() as Record<
				string,
				unknown
			>;
			requests.push(body);
			const auditOnly = body.audit_only === true;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					results: auditOnly
						? []
						: [
								{
									name: "fresh-skill",
									agent: "claude",
									success: true,
									error: null,
								},
							],
					audit: suspiciousAudit,
					audit_confirmation_required: auditOnly,
				}),
			});
		},
	);

	await openAlphaPackUpdate(page);
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	const freshSkillDescription = page.getByText("fresh-skill description");
	await expect(freshSkillDescription).toBeVisible();
	const freshSkillRow = freshSkillDescription.locator(
		"xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' space-y-1.5 ')][1]",
	);
	await expect(freshSkillRow.locator(".card.card--transparent")).toHaveCount(
		1,
	);
	await expect(freshSkillRow.locator(".card.card--secondary")).toHaveCount(0);
	await page.getByRole("button", { name: "Install Selected" }).click();

	const installAnyway = page.getByRole("button", { name: "Install anyway" });
	await expect(installAnyway).toBeVisible();
	const auditCard = page
		.getByRole("heading", { name: "Security audit", exact: true })
		.locator(
			"xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]",
		);
	await expect(auditCard).toHaveCount(1);
	await expect(auditCard.locator(".card.card--transparent")).toHaveCount(1);
	await expect(auditCard.locator(".card.card--secondary")).toHaveCount(0);

	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		audit_only: true,
		session_id: "scan-session-1",
	});
	expect(requests[0]).toMatchObject({
		expected_content_digest: null,
		confirmed_assessment_digest: null,
	});

	await installAnyway.click();
	await expect.poll(() => requests.length).toBe(2);
	expect(requests[1]).toMatchObject({
		audit_only: false,
		expected_content_digest: REVIEW_DIGEST,
		confirmed_assessment_digest: REVIEW_ASSESSMENT_DIGEST,
		session_id: "scan-session-1",
	});
});

test("a changed non-benign re-audit opens its findings", async ({ page }) => {
	await installMocks(page);
	let requestCount = 0;
	await page.route(
		"http://localhost:45999/api/v1/skills/git/install",
		async (route) => {
			requestCount += 1;
			const changed = requestCount === 2;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					results: [],
					audit: changed ? suspiciousAudit : benignAudit,
					audit_confirmation_required: changed,
				}),
			});
		},
	);

	await openAlphaPackUpdate(page);
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await page.getByRole("button", { name: "Install Selected" }).click();

	await expect(
		page.getByText("Downloads and executes a shell script"),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Install anyway" }),
	).toBeVisible();
});

test("an expired install session is re-audited before confirmation is retried", async ({
	page,
}) => {
	await installMocks(page);
	const requests: Array<Record<string, unknown>> = [];
	const refreshedAudit = {
		...suspiciousAudit,
		findings: [
			{
				...suspiciousAudit.findings[0],
				evidence: "Fresh review after session expiry",
			},
		],
		content_digest: "e".repeat(64),
		assessment_digest: "f".repeat(64),
	};
	await page.route(
		"http://localhost:45999/api/v1/skills/install",
		async (route) => {
			const body = route.request().postDataJSON() as Record<
				string,
				unknown
			>;
			requests.push(body);
			if (requests.length === 2) {
				await route.fulfill({
					status: 404,
					contentType: "application/json",
					body: JSON.stringify({
						error: "Session not found or expired",
						code: "SESSION_NOT_FOUND",
					}),
				});
				return;
			}
			const refreshed = requests.length >= 3;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					success: requests.length === 4,
					audit: refreshed ? refreshedAudit : suspiciousAudit,
					audit_confirmation_required: true,
					session_id:
						requests.length === 4
							? null
							: refreshed
								? "session-new"
								: "session-old",
				}),
			});
		},
	);

	const deepLink =
		"aghub://import?type=skill&source=github%2FAkaraChen%2Falpha-pack&name=fresh-skill";
	await page.goto(`/?e2eDeepLink=${encodeURIComponent(deepLink)}`);
	const dialog = page.getByRole("dialog", { name: "Review import" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("row", { name: "Claude", exact: true }).click();
	await dialog.getByRole("button", { name: "Install", exact: true }).click();
	const installAnyway = dialog.getByRole("button", {
		name: "Install anyway",
	});
	await expect(installAnyway).toBeVisible();
	await installAnyway.click();

	await expect(
		dialog.getByText("Fresh review after session expiry"),
	).toBeVisible();
	expect(requests).toHaveLength(3);
	expect(requests[1]).toMatchObject({
		audit_only: false,
		session_id: "session-old",
		expected_content_digest: REVIEW_DIGEST,
		confirmed_assessment_digest: REVIEW_ASSESSMENT_DIGEST,
	});
	expect(requests[2]).toMatchObject({
		audit_only: true,
		session_id: null,
		expected_content_digest: null,
		confirmed_assessment_digest: null,
	});

	await installAnyway.click();
	await expect.poll(() => requests.length).toBe(4);
	expect(requests[3]).toMatchObject({
		audit_only: false,
		session_id: "session-new",
		expected_content_digest: refreshedAudit.content_digest,
		confirmed_assessment_digest: refreshedAudit.assessment_digest,
	});
});

test("a suspicious allowed local audit does not ask for confirmation", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(
		"http://localhost:45999/api/v1/skills/audit",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(allowedSuspiciousAudit),
			});
		},
	);

	await page.goto("/skills");
	await page.evaluate(() => {
		const tauri = (
			window as unknown as {
				__TAURI_INTERNALS__: {
					invoke: (
						command: string,
						args?: unknown,
					) => Promise<unknown>;
				};
			}
		).__TAURI_INTERNALS__;
		const invoke = tauri.invoke.bind(tauri);
		tauri.invoke = (command, args) =>
			command === "plugin:dialog|open"
				? Promise.resolve("/tmp/e2e/suspicious-skill")
				: invoke(command, args);
	});
	await page.getByRole("button", { name: "Add skill" }).click();
	await page.getByRole("menuitem", { name: "Import from File" }).click();
	await page.getByRole("button", { name: "Folder" }).click();

	await expect(page.getByText("Suspicious", { exact: true })).toBeVisible();
	await expect(
		page.getByText(
			"This skill did not pass the security audit. Review the findings, then confirm to install anyway.",
		),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Import", exact: true }),
	).toBeEnabled();
});

test("Git sync audits first and confirms the same content digest before writing", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(
		"http://localhost:45999/api/v1/skills/git/scan",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					session_id: "sync-session-1",
					branches: ["main"],
					current_branch: "main",
					skills: [
						{
							name: "react-pro",
							description: "react-pro from source",
							author: null,
							version: null,
							path: "skills/react-pro",
							audit: suspiciousAudit,
						},
					],
				}),
			});
		},
	);

	const requests: Array<Record<string, unknown>> = [];
	await page.route(
		"http://localhost:45999/api/v1/skills/git/sync",
		async (route) => {
			const body = route.request().postDataJSON() as Record<
				string,
				unknown
			>;
			requests.push(body);
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					success: body.audit_only !== true,
					audit: suspiciousAudit,
					audit_confirmation_required: body.audit_only === true,
					name: "react-pro",
					error: null,
				}),
			});
		},
	);

	await page.goto("/skills");
	await expect(
		page.getByRole("heading", { name: "react-pro" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Sync from source" }).click();
	const dialog = page.getByRole("dialog", { name: "Sync Skill" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Scan", exact: true }).click();
	await expect(dialog.getByText("react-pro from source")).toBeVisible();
	await dialog.getByRole("button", { name: "Confirm" }).click();
	await expect(dialog.getByText("Suspicious", { exact: true })).toBeVisible();

	const sourcePaths = [
		"/tmp/e2e/.claude/skills/react-pro/SKILL.md",
		"/tmp/e2e/.cursor/skills/react-pro/SKILL.md",
	].sort();
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		audit_only: true,
		expected_content_digest: null,
		confirmed_assessment_digest: null,
		session_id: "sync-session-1",
		skill_path: "skills/react-pro",
		source_paths: sourcePaths,
	});

	await dialog
		.getByRole("button", { name: "Sync anyway", exact: true })
		.click();
	await expect.poll(() => requests.length).toBe(2);
	expect(requests[1]).toMatchObject({
		audit_only: false,
		expected_content_digest: REVIEW_DIGEST,
		confirmed_assessment_digest: REVIEW_ASSESSMENT_DIGEST,
		session_id: "sync-session-1",
		skill_path: "skills/react-pro",
		source_paths: sourcePaths,
	});
});

test("resetting a Git scan discards its late response", async ({ page }) => {
	await installMocks(page);
	let releaseScan: (() => void) | undefined;
	const scanGate = new Promise<void>((resolve) => {
		releaseScan = resolve;
	});
	await page.route(
		"http://localhost:45999/api/v1/skills/git/scan",
		async (route) => {
			await scanGate;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					session_id: "late-session",
					branches: ["main"],
					current_branch: "main",
					skills: [
						{
							name: "late-skill",
							description: "late scan result",
							author: null,
							version: null,
							path: "skills/late-skill",
							audit: benignAudit,
						},
					],
				}),
			});
		},
	);

	await openAlphaPackUpdate(page);
	const scanRequest = page.waitForRequest((request) =>
		request.url().endsWith("/api/v1/skills/git/scan"),
	);
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await scanRequest;

	const repositoryCard = page.getByRole("button", {
		name: /Repository & Credentials/,
	});
	await repositoryCard.click();
	await repositoryCard.click();
	await expect(
		page.getByRole("button", { name: "Scan", exact: true }),
	).toBeVisible();

	const scanResponse = page.waitForResponse((response) =>
		response.url().endsWith("/api/v1/skills/git/scan"),
	);
	releaseScan?.();
	await scanResponse;
	await expect(page.getByText("late scan result")).toBeHidden();
});

test("leaving a Git import while auditing never starts the write phase", async ({
	page,
}) => {
	await installMocks(page);
	let releaseAudit: (() => void) | undefined;
	const auditGate = new Promise<void>((resolve) => {
		releaseAudit = resolve;
	});
	const requests: Array<Record<string, unknown>> = [];
	await page.route(
		"http://localhost:45999/api/v1/skills/git/install",
		async (route) => {
			const body = route.request().postDataJSON() as Record<
				string,
				unknown
			>;
			requests.push(body);
			if (body.audit_only === true) await auditGate;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					results: [],
					audit: benignAudit,
					audit_confirmation_required: false,
				}),
			});
		},
	);

	await openAlphaPackUpdate(page);
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await page.getByRole("button", { name: "Install Selected" }).click();
	await expect(page.getByText("Auditing", { exact: true })).toBeVisible();

	await page
		.getByRole("button", { name: /Repository & Credentials/ })
		.click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(
		page.getByRole("heading", {
			name: "github/AkaraChen/alpha-pack",
		}),
	).toBeVisible();

	releaseAudit?.();
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() => resolve()),
				),
			),
	);

	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({ audit_only: true });
});

test("switching branches discards the previous audit and session", async ({
	page,
}) => {
	await installMocks(page);
	await page.route(
		"http://localhost:45999/api/v1/skills/git/scan",
		async (route) => {
			const body = route.request().postDataJSON() as {
				branch?: string | null;
			};
			const branch = body.branch ?? "main";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					session_id: `${branch}-session`,
					branches: ["main", "next"],
					current_branch: branch,
					skills: [
						{
							name: `${branch}-skill`,
							description: `${branch} branch skill`,
							author: null,
							version: null,
							path: `skills/${branch}-skill`,
							audit:
								branch === "main"
									? suspiciousAudit
									: benignAudit,
						},
					],
				}),
			});
		},
	);

	const requests: Array<Record<string, unknown>> = [];
	await page.route(
		"http://localhost:45999/api/v1/skills/git/install",
		async (route) => {
			const body = route.request().postDataJSON() as Record<
				string,
				unknown
			>;
			requests.push(body);
			const onMain = body.session_id === "main-session";
			const audit = onMain ? suspiciousAudit : benignAudit;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					results:
						body.audit_only === true
							? []
							: [
									{
										name: "next-skill",
										agent: "claude",
										success: true,
										error: null,
									},
								],
					audit,
					audit_confirmation_required:
						onMain && body.audit_only === true,
				}),
			});
		},
	);

	await openAlphaPackUpdate(page);
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await expect(page.getByText("main branch skill")).toBeVisible();
	await page.getByRole("button", { name: "Install Selected" }).click();
	await expect(
		page.getByRole("button", { name: "Install anyway" }),
	).toBeVisible();
	const branchSelect = page.locator(".select").filter({
		has: page.getByText("Branch", { exact: true }),
	});
	await expect(branchSelect.locator(".select__trigger")).toBeDisabled();

	await page.getByRole("button", { name: "Back", exact: true }).click();
	await branchSelect.locator(".select__trigger").click();
	await page.getByRole("option", { name: "next", exact: true }).click();
	await expect(page.getByText("next branch skill")).toBeVisible();

	await page.getByRole("button", { name: "Install Selected" }).click();
	await expect.poll(() => requests.length).toBe(3);
	expect(requests[0]).toMatchObject({
		audit_only: true,
		session_id: "main-session",
	});
	expect(requests[1]).toMatchObject({
		audit_only: true,
		session_id: "next-session",
	});
	expect(requests[2]).toMatchObject({
		audit_only: false,
		expected_content_digest: benignAudit.content_digest,
		confirmed_assessment_digest: null,
		session_id: "next-session",
	});
});

test("disabling automatic scans skips preview but keeps write-time assessment", async ({
	page,
}) => {
	await installMocks(page);
	const auditRequests: Array<Record<string, unknown>> = [];
	const scanRequests: Array<Record<string, unknown>> = [];
	const installRequests: Array<Record<string, unknown>> = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/api/v1/skills/audit")) {
			auditRequests.push(request.postDataJSON());
		}
		if (request.url().endsWith("/api/v1/skills/git/scan")) {
			scanRequests.push(request.postDataJSON());
		}
		if (request.url().endsWith("/api/v1/skills/git/install")) {
			installRequests.push(request.postDataJSON());
		}
	});

	await page.goto("/settings?tab=security");
	const scanSwitch = page.getByRole("switch", {
		name: "Automatic skill security scans",
	});
	await expect(scanSwitch).toBeChecked();
	await scanSwitch.press("Space");
	await expect(scanSwitch).not.toBeChecked();

	await page.getByRole("link", { name: "Skills", exact: true }).click();
	await expect(
		page.getByRole("option", { name: "solo-skill" }),
	).toBeVisible();
	await page
		.getByRole("button", {
			name: "github/AkaraChen/alpha-pack",
			exact: true,
		})
		.click();
	await page.getByRole("button", { name: "Update from source" }).click();
	await page.getByRole("button", { name: "Scan", exact: true }).click();
	await expect(page.getByText("fresh-skill description")).toBeVisible();
	await page.getByRole("button", { name: "Install Selected" }).click();
	await expect(
		page.getByRole("heading", { name: "Installation complete" }),
	).toBeVisible();

	expect(auditRequests).toHaveLength(0);
	expect(scanRequests).toHaveLength(1);
	expect(scanRequests[0]).toMatchObject({ skip_audit: true });
	expect(installRequests).toHaveLength(1);
	expect(installRequests[0]).toMatchObject({
		audit_only: false,
		expected_content_digest: null,
		confirmed_assessment_digest: null,
	});
	expect(installRequests[0]).not.toHaveProperty("skip_audit");
	await expect(
		page.getByRole("heading", { name: "Security audit", exact: true }),
	).toHaveCount(0);
});
