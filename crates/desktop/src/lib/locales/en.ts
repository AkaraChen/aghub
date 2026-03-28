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
	onboardingHeaderSubtitle: "Get started with aghub",
	onboardingStepCounter: "Step {{current}} of {{total}}",
	onboardingSkip: "Skip for now",
	onboardingMaybeLater: "Maybe later",
	onboardingFooterHint:
		"About a minute. You can reopen this from Settings later.",
	onboardingPrimaryAction: "Open MCP Servers",
	onboardingSavingProgress: "Saving your onboarding progress...",
	onboardingWelcomeEyebrow: "Start here",
	onboardingWelcomeTitle: "Keep your AI agent setup in one place.",
	onboardingWelcomeBody:
		"aghub keeps your usual MCP servers and skills in one place.",
	onboardingWelcomeBulletOne:
		"Add MCP servers once instead of editing each agent's config by hand.",
	onboardingWelcomeBulletTwo:
		"Reuse skills instead of rewriting the same instructions and prompts.",
	onboardingWelcomeBulletThree: "",
	onboardingHeroBadge: "First-run tour",
	onboardingAgentCoverage: "{{count}} agents supported",
	onboardingOverviewTitle:
		"You do not need to memorize where every agent stores its setup.",
	onboardingOverviewBody:
		"aghub gives you one place to manage the pieces that shape how your agents work.",
	onboardingWelcomeVisualIntro: "The core workflow is simple:",
	onboardingFeatureMcpTitle: "Add tools once",
	onboardingFeatureMcpDescription:
		"Set up MCP servers once and send them to the agents that support them.",
	onboardingFeatureSkillsTitle: "Reuse good workflows",
	onboardingFeatureSkillsDescription:
		"Save repeatable instructions as skills instead of rebuilding them each time.",
	onboardingFeatureScopeTitle: "Separate by repo",
	onboardingFeatureScopeDescription:
		"Reuse your default MCPs and skills everywhere, then add repo-only ones where needed.",
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
	onboardingMcpTitle: "Give your agents real tools to work with.",
	onboardingMcpBody:
		"MCP servers connect an agent to things like local commands, APIs, and data sources. aghub helps you add them once and use them in the right places.",
	onboardingMcpBulletOne:
		"Connect local or remote tools without hunting through multiple config files.",
	onboardingMcpBulletTwo:
		"Choose which agents should get a tool before you save the change.",
	onboardingMcpBulletThree: "",
	onboardingMcpVisualTitle: "A simple MCP flow",
	onboardingMcpVisualBody:
		"You should be able to add a tool in a few clear steps and know where it will be available.",
	onboardingMcpFlowOneTitle: "Add a server",
	onboardingMcpFlowOneBody:
		"Bring in a local command or remote service that you want your agents to use.",
	onboardingMcpFlowTwoTitle: "Choose the agents",
	onboardingMcpFlowTwoBody:
		"Apply it only to the agents that support it and matter to your workflow.",
	onboardingMcpFlowThreeTitle: "Use it with confidence",
	onboardingMcpFlowThreeBody:
		"See what is available before you edit, disable, or remove anything.",
	onboardingMcpTransportStdio:
		"Launch a local command and let the agent talk over stdio.",
	onboardingMcpTransportSse:
		"Connect to a remote MCP endpoint using server-sent events.",
	onboardingMcpTransportHttp:
		"Use modern streamable HTTP endpoints with headers and timeouts when needed.",
	onboardingMcpAppliesLabel: "Typical rollout",
	onboardingSkillsEyebrow: "Skills",
	onboardingSkillsTitle: "Turn repeatable prompts into reusable workflows.",
	onboardingSkillsBody:
		"Skills bundle instructions and supporting files so a workflow can be reused instead of rewritten from scratch.",
	onboardingSkillsBulletOne:
		"Create your own skills for the tasks your team repeats all the time.",
	onboardingSkillsBulletTwo:
		"Import local or packaged skills instead of copy-pasting prompts between tools.",
	onboardingSkillsBulletThree: "",
	onboardingStartEyebrow: "Start from here",
	onboardingStartTitle: "Open the page that fits what you want to do first.",
	onboardingStartBody:
		"You do not need to set up everything at once. Start with one page now and fill in the rest later.",
	onboardingStartBulletOne:
		"If you want agents to use tools first, start with MCP Servers.",
	onboardingStartBulletTwo:
		"If you want to organize workflows or install existing ones, go to Skills or skills.sh.",
	onboardingSkillsVisualTitle: "A few good skills go a long way",
	onboardingSkillsVisualBody:
		"Start with a couple of high-value workflows and expand from there.",
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
	onboardingNextStepTitle: "Choose a page to start with",
	onboardingNextStepBody:
		"Open one page and start there. You can fill in the rest later.",
	onboardingReplayHint: "Replay from Settings > About",
	onboardingStartMcpTitle: "Add an MCP Server",
	onboardingStartMcpBody:
		"Connect one useful tool and make it available where you need it.",
	onboardingStartMcpCta: "Open MCP Servers",
	onboardingStartSkillsTitle: "Open Skills",
	onboardingStartSkillsBody:
		"Create or import a reusable workflow for your personal or team setup.",
	onboardingStartSkillsCta: "Open Skills",
	onboardingStartMarketTitle: "Browse skills.sh",
	onboardingStartMarketBody:
		"Explore installable skills from the marketplace and add them to selected agents.",
	onboardingStartMarketCta: "Open skills.sh",
	onboardingMarketNote:
		"You can browse more installable workflows any time in skills.sh.",

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
