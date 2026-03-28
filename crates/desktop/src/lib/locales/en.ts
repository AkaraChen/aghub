export default {
	// Common
	settings: "Settings",
	skills: "Skills",
	mcpServers: "MCP Servers",
	skillsSh: "skills.sh",
	mcp: "MCP",
	agentManagement: "Agent",
	projects: "Projects",
	search: "Search",
	add: "Add",
	refresh: "Refresh",
	remove: "Remove",
	edit: "Edit",
	save: "Save",
	cancel: "Cancel",
	create: "Create",
	copy: "Copy",
	disabled: "Disabled",
	all: "All",
	enabled: "Enabled",

	// Settings
	appearance: "Appearance",
	theme: "Theme",
	themeDescription: "Choose your preferred color scheme",
	language: "Language",
	languageDescription: "Select your preferred language",
	light: "Light",
	dark: "Dark",
	system: "System",
	english: "English",
	chinese: "中文",
	noAgentsDescription: "Install AI coding agents to manage them here.",
	searchAgents: "Search agents...",
	noAgentsMatch: "No agents match",
	adjustFiltersDescription: "Try adjusting your search or filters.",

	// Integrations
	integrations: "Integrations",
	codeEditors: "Code Editor",
	codeEditorsDescription:
		"Choose your preferred code editor for opening files",

	// Application
	application: "About",
	appName: "App Name",
	updates: "Updates",
	checkForUpdates: "Check for Updates",
	checkAgain: "Check Again",
	noUpdatesAvailable: "No updates available",
	updateAvailable: "Version {{version}} available",
	checkingForUpdates: "Checking for updates...",
	downloadingUpdate: "Downloading update...",
	installingUpdate: "Installing update...",
	updateError: "Update error",
	clickToCheckUpdates: "Click to check for updates",
	downloadAndInstall: "Download and Install",
	updateInstalledSuccess: "Update installed successfully",
	restartToUpdate: "Restart to Update",
	onboarding: "Onboarding",
	onboardingDescription:
		"Review the getting-started guide again whenever you need it",
	previewOnboarding: "View Tour",
	onboardingOpenError: "Could not open the guide",
	onboardingHeaderSubtitle:
		"See how aghub helps you set up tools and workflows faster",
	onboardingSkip: "Skip for now",
	onboardingFooterHint:
		"Four short screens. You can reopen this tour from Settings later.",
	onboardingPrimaryAction: "Open MCP Servers",
	onboardingSavingProgress: "Saving your onboarding progress...",
	onboardingWelcomeEyebrow: "What aghub does",
	onboardingWelcomeTitle: "One hub for every AI coding agent.",
	onboardingWelcomeBody:
		"aghub helps you manage MCP servers, skills, and project-specific setup without losing track of what each agent is actually using.",
	onboardingWelcomeBulletOne:
		"Configure shared tooling once, then carry it across your supported agents.",
	onboardingWelcomeBulletTwo:
		"Review the real config surface instead of guessing through opaque app state.",
	onboardingWelcomeBulletThree:
		"Keep changes explicit so global defaults stay separate from project overrides.",
	onboardingHeroBadge: "First-run tour",
	onboardingAgentCoverage: "{{count}} agents supported",
	onboardingWelcomeVisualIntro: "The core workflow is simple:",
	onboardingFeatureMcpTitle: "Unify MCP servers",
	onboardingFeatureMcpDescription:
		"Define a server once, then reuse it across the agents that can run it.",
	onboardingFeatureSkillsTitle: "Ship portable skills",
	onboardingFeatureSkillsDescription:
		"Turn repeatable workflows into reusable SKILL.md-based bundles.",
	onboardingFeatureScopeTitle: "Keep setup organized",
	onboardingFeatureScopeDescription:
		"Use your everyday setup everywhere, and keep repo-specific additions only where they help.",
	onboardingMoreAgents: "+ more",
	onboardingStatConfigure: "Configure Once",
	onboardingStatConfigureValue: "MCP + Skills",
	onboardingStatConfigureDescription:
		"Use the same setup across multiple agents without manually editing every config file.",
	onboardingStatReview: "See Source",
	onboardingStatReviewValue: "Global / Project",
	onboardingStatReviewDescription:
		"Know whether a server or skill came from a global default or a repo-specific setup.",
	onboardingStatScope: "Stay Precise",
	onboardingStatScopeValue: "Explicit Opt-In",
	onboardingStatScopeDescription:
		"Aghub helps you change agent config deliberately instead of hiding it behind sync magic.",
	onboardingMcpEyebrow: "MCP servers",
	onboardingMcpTitle: "MCPs connect agents to real tools.",
	onboardingMcpBody:
		"In aghub, MCP servers are external capabilities you attach to coding agents, from local command-based tools to remote HTTP services.",
	onboardingMcpBulletOne:
		"Add a server once and apply it to the agents that support it.",
	onboardingMcpBulletTwo:
		"Use stdio, SSE, or Streamable HTTP transport depending on how the tool runs.",
	onboardingMcpBulletThree:
		"Enable or disable a server without deleting the definition you may need later.",
	onboardingMcpVisualTitle: "One server definition, multiple agents",
	onboardingMcpVisualBody:
		"Aghub treats MCP as a reusable connection layer instead of a one-off agent setting.",
	onboardingMcpTransportStdio:
		"Launch a local command and let the agent talk over stdio.",
	onboardingMcpTransportSse:
		"Connect to a remote MCP endpoint using server-sent events.",
	onboardingMcpTransportHttp:
		"Use modern streamable HTTP endpoints with headers and timeouts when needed.",
	onboardingMcpAppliesLabel: "Typical rollout",
	onboardingSkillsEyebrow: "Skills",
	onboardingSkillsTitle: "Skills make instructions portable.",
	onboardingSkillsBody:
		"Aghub treats skills as reusable instruction bundles, usually built around a SKILL.md file plus optional supporting files, so the same workflow can travel between agents.",
	onboardingSkillsBulletOne:
		"Author custom skills locally when your team has repeatable tasks.",
	onboardingSkillsBulletTwo:
		"Import packaged skills or local folders instead of copy-pasting prompts.",
	onboardingSkillsBulletThree:
		"Keep author, version, tools, and file contents visible before you install.",
	onboardingSkillsVisualTitle: "Skills are bundles, not loose prompts",
	onboardingSkillsVisualBody:
		"They can describe a workflow, include helper files, and declare the tools they rely on.",
	onboardingSkillExampleReview:
		"Review pull requests with the same checklist across agents.",
	onboardingSkillExampleCi:
		"Check failing CI, inspect logs, and propose fixes consistently.",
	onboardingSkillExampleShip:
		"Package a release workflow once, then share it with the whole team.",
	onboardingSkillExampleMarket:
		"Install community workflows from the skills.sh marketplace.",
	onboardingSkillsSignalsLabel: "Why this matters",
	onboardingSignalMarketTitle: "Marketplace + local",
	onboardingSignalMarketBody:
		"Mix community skills from skills.sh with private team skills.",
	onboardingSignalProvenanceTitle: "Provenance visible",
	onboardingSignalProvenanceBody:
		"Track source, author, version, and file contents before trusting a skill.",
	onboardingSignalToolsTitle: "Tool expectations",
	onboardingSignalToolsBody:
		"See which tools a skill expects so agent behavior stays predictable.",
	onboardingScopeEyebrow: "Personal + project setup",
	onboardingScopeTitle:
		"Keep your everyday setup separate from repo-specific work.",
	onboardingScopeBody:
		"Set up the tools and workflows you use all the time once, then add project-only context where it matters. Aghub helps you see what a project has available without digging through config files.",
	onboardingScopeBulletOne:
		"Open a project and quickly see what is unique to that repo.",
	onboardingScopeBulletTwo: "See the full setup before you change anything.",
	onboardingScopeBulletThree:
		"Jump straight into adding tools, reusable workflows, or project-specific setup.",
	onboardingScopeGlobalTitle: "Use across all projects",
	onboardingScopeGlobalBody:
		"Set up your usual tools and workflows once, then reuse them everywhere.",
	onboardingScopeGlobalItemOne:
		"The tools you expect to have ready in every codebase.",
	onboardingScopeGlobalItemTwo:
		"Shared workflows that belong in your day-to-day setup.",
	onboardingScopeProjectTitle: "Add what this repo needs",
	onboardingScopeProjectBody:
		"Keep customer, domain, or repo-specific setup in the place where you need it.",
	onboardingScopeProjectItemOne:
		"Special workflows that only make sense for this codebase.",
	onboardingScopeProjectItemTwo:
		"Extra tools that should not follow you into unrelated projects.",
	onboardingScopeMergedTitle: "See everything available here",
	onboardingScopeMergedBody:
		"Get the full picture at a glance so you can move with confidence.",
	onboardingScopeMergedItemOne:
		"Understand what is available before you edit or remove it.",
	onboardingScopeMergedItemTwo:
		"Stop guessing what your agent will be able to use in this project.",
	onboardingNextStepTitle: "Choose your starting point",
	onboardingNextStepBody:
		"Most teams get value fastest by adding one MCP, one skill, or one project-specific override.",
	onboardingReplayHint: "Replay from Settings > About",
	onboardingStartMcpTitle: "Add an MCP Server",
	onboardingStartMcpBody:
		"Connect a tool or data source and make it available across supported agents.",
	onboardingStartSkillsTitle: "Open Skills",
	onboardingStartSkillsBody:
		"Create or import a reusable workflow for your personal or team setup.",
	onboardingStartMarketTitle: "Browse skills.sh",
	onboardingStartMarketBody:
		"Explore installable skills from the marketplace and add them to selected agents.",

	// Agent Management
	agentManagementDescription:
		"Manage which agents are available for creating skills and MCP servers. Disable agents you don't use.",
	globalConfig: "Global Config",
	cli: "CLI",
	detectedVia: "Detected via {{sources}}",
	available: "Available",
	notAvailable: "Not Available",
	disabledByUser: "Disabled",
	toggleAgent: "Toggle {{name}}",
	enableAgentTooltip: "Enable {{name}} to use it in projects",
	disableAgentTooltip: "Disable {{name}} to hide it from project options",
	supports: "Supports",
	cliName: "CLI command",

	// Skills Page
	searchSkills: "Search skills...",
	multiSelect: "Multi-select mode",
	selectItems: "Select",
	doneSelecting: "Cancel",
	addSkill: "Add skill",
	refreshSkills: "Refresh skills",
	noSkillsMatch: "No skills match",
	selectSkill: "Select a skill to view details",
	deleteSelected: "Delete Selected",
	itemsSelected: "{{count}} items selected",
	bulkDeleteConfirmTitle: "Bulk Delete",
	bulkDeleteSkillConfirm:
		"Are you sure you want to delete the {{count}} selected skills from all installed agents?",
	bulkDeleteMcpConfirm:
		"Are you sure you want to delete the {{count}} selected MCP servers from all installed agents?",
	bulkDeleteMixedConfirm:
		"Are you sure you want to delete the {{count}} selected resources from this project?",
	starSkill: "Favorite",
	unstarSkill: "Unfavorite",
	starServer: "Favorite",
	unstarServer: "Unfavorite",
	description: "Description",
	author: "Author",
	version: "Version",
	tools: "Tools",
	source: "Source",
	openFolder: "Open folder",
	openInBrowser: "View source",
	editInEditor: "Edit in editor",
	skillFiles: "Files",
	skillFilesDescription: "{{count}} items available in this skill bundle",
	createSkill: "Create Skill",
	addLocalSkill: "Add Local Skill",
	createLocalSkill: "Create New Skill",
	createCustomSkill: "Create Custom Skill",
	importFromFile: "Import from File",
	selectFileOrFolder: "Select a file or folder containing SKILL.md",
	skillImported: "Skill imported successfully",
	importError: "Failed to import skill: {{error}}",
	selectedPath: "Selected Path",
	file: "File",
	folder: "Folder",
	installFromMarket: "Install from Market",
	skillName: "Skill Name",
	skillCreated: "Skill created successfully",
	content: "Content",
	requiredTools: "Required Tools",
	csvToolsHelp:
		"List the tools this skill depends on, separated by commas (e.g., bash, jq, git)",
	skillNamePlaceholder: "e.g., format-code",
	descriptionPlaceholder: "Enter a brief description for this skill...",
	authorPlaceholder: "Enter the author's name...",
	skillContentPlaceholder:
		"Enter the SKILL.md body, such as instructions, examples, and usage notes...",
	skillContentHelp:
		"This becomes the body of SKILL.md after the frontmatter.",
	toolsPlaceholder: "e.g., bash, rg, jq",
	targetAgent: "Target Agent",
	searchMarket: "Market Search",
	searchMarketPlaceholder: "Search skills.sh marketplace...",
	searching: "Searching...",
	noResults: "No results",

	// MCP Servers Page
	searchServers: "Search servers...",
	addMcpServer: "Add MCP server",
	refreshServers: "Refresh servers",
	noServersMatch: "No servers match",
	selectServer: "Select a server to view details",
	orCreateNew: "or create a new one",
	transport: "Transport",
	type: "Type",
	details: "Details",
	command: "Command",
	args: "Arguments",
	url: "URL",
	timeout: "Timeout",
	unknown: "unknown",
	deleteMcpServer: "Delete server",
	deleteMcpServerConfirm: 'Delete "{{name}}"? This can\'t be undone.',
	deleteMcpMultipleConfirm:
		'This removes "{{name}}" from {{count}} agents ({{agents}}). This can\'t be undone.',
	deleting: "Deleting...",
	editMcpServer: "Edit MCP Server",
	multipleAgents: "Multiple Agents",
	changeWillApplyToAgents:
		"This change will apply to {{count}} agents: {{agents}}",
	name: "Name",
	serverName: "Server name",
	transportType: "Transport Type",
	env: "Environment Variables",
	headers: "Headers",
	argsHelp: "Space-separated arguments",
	timeoutHelp: "Seconds (optional)",
	enabledHelp: "Toggle whether this MCP server is active.",
	saving: "Saving...",
	saveError: "Failed to save: {{error}}",
	createMcpServer: "Create MCP Server",
	creating: "Creating...",
	createError: "Failed to create: {{error}}",
	advanced: "Advanced",
	agents: "Agents",
	noAgentsAvailable: "No agents available",
	noAgentsAvailableHelp:
		"Install or enable at least one agent to create MCP servers or skills.",
	validationNameRequired: "Enter a server name.",
	validationCommandRequired: "Enter a command.",
	validationUrlRequired: "Enter a URL.",
	validationUrlInvalid: "Enter a valid URL.",
	validationUrlProtocol: "URL must start with http:// or https://.",
	validationTimeoutPositiveInteger:
		"Timeout must be a positive whole number.",
	validationAgentsRequired: "Select at least one agent.",
	validationKeyRequired: "Enter a key.",
	validationValueRequired: "Enter a value.",
	validationDuplicateKey: "Each key must be unique.",
	validationSkillNameRequired: "Enter a skill name.",
	validationDescriptionRequired: "Enter a description.",
	validationContentRequired: "Enter skill content.",
	validationPathRequired: "Select a file or folder first.",
	validationJsonRequired: "Paste a JSON configuration first.",
	validationProjectNameRequired: "Enter a project name.",
	validationProjectPathRequired: "Select a project folder first.",
	importFromJson: "Import from JSON",
	importFromJsonTooltip: "Import from JSON",
	import: "Import",
	importing: "Importing",
	manualCreation: "Manual Creation",
	parse: "Parse",
	parseAndImport: "Parse & Import",
	parsedServer: "Parsed Server",
	confirmImport: "Confirm Import",
	confirm: "Confirm",
	jsonConfig: "JSON Configuration",
	jsonConfigHelp: "Paste the MCP server JSON configuration",
	invalidJson: "Invalid JSON format",
	parseError: "Failed to parse MCP configuration",
	jsonConfigPlaceholder:
		'{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "package-name"]\n    }\n  }\n}',

	// Manage Agents Dialog
	manageAgents: "Manage Agents",
	manageAgentsTooltip: "Choose which agents use this server",
	adding: "Adding",
	removing: "Removing",
	alreadyAdded: "Added",
	unconfigured: "Unconfigured",
	applyChanges: "Apply changes",
	agentChangesApplied: "Updated {{count}} agent(s) successfully",
	agentChangesFailed: "{{success}} succeeded, {{failed}} failed",
	selectAgents: "Select Agents",
	confirmChanges: "Confirm Changes",
	result: "Result",
	next: "Next",
	back: "Back",
	apply: "Apply",
	applying: "Applying...",
	done: "Done",
	toInstall: "To install",
	toUninstall: "To uninstall",
	noChanges: "No changes to apply.",
	installing: "Installing...",
	uninstalling: "Uninstalling...",
	installSuccess: "Installed successfully",
	uninstallSuccess: "Uninstalled successfully",
	installFailed: "Failed to install",
	uninstallFailed: "Failed to uninstall",
	selectAgentsForMcp: "Select which agents should have this MCP server:",
	noTargetAgents: "No available agents.",

	// Install Skill Dialog
	installSkill: "Install Skill",
	selectSourceAndAgents: "Select Source & Agents",
	installation: "Installation",
	install: "Install",
	searchSkillMarketDescription: "Search skills.sh to install a skill.",
	searchResults: "Search Results",
	selectedSkill: "Selected Skill",
	installingSkill: "Installing Skill",
	selectAgentsForSkill: "Select which agents to install this skill to:",
	installs: "installs",
	installAllSkills: "Install All Skills",
	installAllSkillsDescription:
		"Install all skills from this source instead of the selected skill.",
	installToProject: "Install to Project",
	installToProjectDescription:
		"Install skills to a specific project instead of global scope.",
	selectProject: "Select Project",
	noProjects: "No projects available",
	noProjectsHelp: "Add a project first to install skills to it.",
	copyTooltip: "Copy as JSON",
	copied: "Copied to clipboard",
	editTooltip: "Edit server",
	deleteTooltip: "Delete server",

	// skills.sh
	searchMarketSkills: "Search skills.sh...",
	searchMarketSkillsPlaceholder: "Enter skill name or keyword...",
	searchToFindSkills: "Search to find skills from skills.sh",
	poweredByVercel: "Powered by Vercel",
	dataFromSkillsSh: "Data from skills.sh",

	// MCP Detail
	connection: "Connection",
	addToAgent: "Add to Agent",
	copyConfig: "Copy as JSON",
	copyConfigSuccess: "Copied to clipboard",
	copyConfigError: "Failed to copy to clipboard",
	global: "Global",
	project: "Project",
	headersCount: "Headers ({{count}})",
	envCount: "Environment variables ({{count}})",
	noHeaders: "No headers",
	noEnvVars: "No environment variables",
	timeoutSeconds: "{{seconds}}s",
	deleteMcpSuccess: "MCP server deleted successfully",
	deleteMcpError: "Failed to delete MCP server",

	// Projects
	addProject: "Add Project",
	projectName: "Project Name",
	projectPath: "Project Path",
	projectPathPlaceholder: "/path/to/your/project",
	selectProjectFolder: "Select Project Folder",
	clickToBrowse: "Click to browse your files",
	projectNotFound: "Project not found",
	mcps: "MCPs",
	projectStats: "Project Statistics",

	// Project Resources
	searchResources: "Search resources...",
	refreshResources: "Refresh resources",
	noResourcesMatch: "No resources match",
	noProjectResources: "No resources in this project",
	selectResourceToView: "Select a resource to view details",

	// Skill Detail
	deleteSkill: "Delete Skill",
	deleteSkillWarning:
		"This will delete {{count}} skill installation(s). This action cannot be undone.",
	deleteAll: "Delete All",
	locations: "Locations",
	globalSkills: "Global Skills",
	projectSkills: "Project Skills",
	metadata: "Metadata",
	installedFrom: "Installed From",
	default: "Default",
	showMore: "Show more ({{count}})",
	showLess: "Show less",
	skillContent: "Content",
	noContent: "No content",
	symlink: "Symlink",
	symlinkTarget: "→ {{target}}",

	// Env Editor
	envEditor: {
		addKeypair: "Add Keypair",
		keyPlaceholder: "Key",
		valuePlaceholder: "Value",
		importFromClipboard: "Import from Clipboard",
	},

	// Key Pair Editor
	keyPairEditor: {
		keyPlaceholder: "Key",
		valuePlaceholder: "Value",
		addPair: "Add Pair",
	},

	// HTTP Header Editor
	httpHeaderEditor: {
		keyPlaceholder: "Header Name",
		valuePlaceholder: "Header Value",
	},

	// Team
	team: "Team",
	headDev: "Head Dev",
	developer: "Developer",
	designer: "Designer",
};
