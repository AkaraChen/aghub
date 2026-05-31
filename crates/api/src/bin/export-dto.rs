use std::{
	fs,
	io::{self, Write},
	path::{Path, PathBuf},
};

use aghub_api::dto::usage::{
	AgentUsageDto, UsageDayDto, UsageModelDto, UsageReportDto, UsageTotalsDto,
};
use aghub_api::dto::{
	agents::{
		AgentAvailabilityDto, AgentInfo, CapabilitiesDto, McpCapabilitiesDto,
		ScopeSupportDto, SkillCapabilitiesDto, SkillsPathsDto,
		SubAgentCapabilitiesDto,
	},
	common::ConfigSource,
	credential::{CreateCredentialRequest, CredentialResponse},
	inference::{
		AgentProviderCredentialDto,
		AgentProviderMatchedInferenceProviderResponse,
		AgentProviderModelResponse, AgentProviderResponse,
		AgentProviderSourceDto, ClaudeProviderStateResponse,
		CodexProfileResponse, CodexProviderStateResponse,
		CreateAgentProviderRequest, CreateInferenceProviderRequest,
		InferenceProviderFormatDto, InferenceProviderPasswordResponse,
		InferenceProviderPresetResponse, InferenceProviderResponse,
		UpdateAgentProviderRequest, UpdateClaudeProviderRequest,
		UpdateCodexActiveProfileRequest, UpdateCodexProfileProviderRequest,
		UpdateInferenceProviderRequest,
	},
	integrations::{
		CodeEditorType, EditSkillFolderRequest, OpenSkillFolderRequest,
		OpenWithEditorRequest, ToolInfoDto, ToolPreferencesDto,
	},
	market::MarketSkill,
	mcp::{CreateMcpRequest, McpResponse, TransportDto, UpdateMcpRequest},
	plugin::{
		CCMarketplaceAddRequest, CCMarketplaceEntryResponse,
		CCMarketplaceListResponse, CCMarketplaceMutationResponse,
		CCMarketplaceSourceResponse, CCPluginAuthorResponse,
		CCPluginCliStatusResponse, CCPluginConfigResponse,
		CCPluginDetailResponse, CCPluginHookActionResponse,
		CCPluginHookEventResponse, CCPluginHookMatcherResponse,
		CCPluginHooksManifestResponse, CCPluginInstallRequest,
		CCPluginInstallResponse, CCPluginListResponse,
		CCPluginManifestResponse, CCPluginMarketResponse,
		CCPluginMcpConfigResponse, CCPluginMcpServerResponse,
		CCPluginOpenSkillInEditorRequest, CCPluginPruneRequest,
		CCPluginPruneResponse, CCPluginResponse, CCPluginScopeResponse,
		CCPluginSkillInfo, CCPluginSourceInfoResponse,
		CCPluginUninstallRequest, CCPluginUninstallResponse,
		CCPluginUpdateConfigRequest, CCPluginUpdateRequest,
		CCPluginUpdateResponse, CCPluginValidateRequest,
		CCPluginValidateResponse,
	},
	skill::{
		CreateSkillRequest, DeleteSkillByPathRequest,
		DeleteSkillByPathResponse, GitInstallRequest, GitInstallResponse,
		GitInstallResultEntry, GitScanRequest, GitScanResponse,
		GitScanSkillEntry, GitSyncRequest, GitSyncResponse,
		GlobalSkillLockResponse, ImportSkillRequest, InstallSkillRequest,
		InstallSkillResponse, LocalSkillLockEntryResponse, ProjectLockQuery,
		ProjectSkillLockResponse, SkillContentQuery, SkillLockEntryResponse,
		SkillResponse, SkillTreeNodeKind, SkillTreeNodeResponse,
		SkillTreeQuery, UpdateSkillRequest, ValidationError,
	},
	sub_agent::{
		CreateSubAgentRequest, SubAgentResponse, UpdateSubAgentRequest,
	},
	transfer::{
		InstallScopeDto, OperationActionDto, OperationBatchResponse,
		OperationResultDto, ReconcileRequest, ResourceLocatorDto, TargetDto,
		TransferRequest,
	},
};
use ts_rs::{Config, TS};

fn workspace_root() -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR"))
		.parent()
		.and_then(Path::parent)
		.expect("api crate should live under workspace/crates/api")
		.to_path_buf()
}

fn output_dir() -> PathBuf {
	workspace_root().join("crates/desktop/src/generated/dto")
}

fn disallowed_output_dir() -> PathBuf {
	workspace_root().join("crates/api/bindings")
}

fn export_type<T: TS + 'static>(
	cfg: &Config,
) -> Result<(), ts_rs::ExportError> {
	T::export(cfg)
}

fn write_index_file(dir: &Path) -> io::Result<()> {
	let mut entries = fs::read_dir(dir)?
		.filter_map(Result::ok)
		.filter_map(|entry| {
			let path = entry.path();
			let stem = path.file_stem()?.to_str()?;
			let ext = path.extension()?.to_str()?;
			if ext != "ts" || stem == "index" {
				return None;
			}
			Some(stem.to_string())
		})
		.collect::<Vec<_>>();

	entries.sort();

	let mut file = fs::File::create(dir.join("index.ts"))?;
	for entry in entries {
		writeln!(file, "export type {{ {entry} }} from \"./{entry}\";")?;
	}

	Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
	let out_dir = output_dir();
	let disallowed_dir = disallowed_output_dir();

	if out_dir.exists() {
		fs::remove_dir_all(&out_dir)?;
	}
	fs::create_dir_all(&out_dir)?;
	if disallowed_dir.exists() {
		fs::remove_dir_all(&disallowed_dir)?;
	}

	let cfg = Config::new()
		.with_out_dir(&out_dir)
		.with_large_int("number");

	export_type::<ScopeSupportDto>(&cfg)?;
	export_type::<SkillCapabilitiesDto>(&cfg)?;
	export_type::<McpCapabilitiesDto>(&cfg)?;
	export_type::<SubAgentCapabilitiesDto>(&cfg)?;
	export_type::<CapabilitiesDto>(&cfg)?;
	export_type::<SkillsPathsDto>(&cfg)?;
	export_type::<AgentInfo>(&cfg)?;
	export_type::<AgentAvailabilityDto>(&cfg)?;
	export_type::<ConfigSource>(&cfg)?;
	export_type::<CreateCredentialRequest>(&cfg)?;
	export_type::<CredentialResponse>(&cfg)?;
	export_type::<AgentProviderSourceDto>(&cfg)?;
	export_type::<AgentProviderCredentialDto>(&cfg)?;
	export_type::<AgentProviderModelResponse>(&cfg)?;
	export_type::<AgentProviderMatchedInferenceProviderResponse>(&cfg)?;
	export_type::<AgentProviderResponse>(&cfg)?;
	export_type::<ClaudeProviderStateResponse>(&cfg)?;
	export_type::<UpdateClaudeProviderRequest>(&cfg)?;
	export_type::<CodexProfileResponse>(&cfg)?;
	export_type::<CodexProviderStateResponse>(&cfg)?;
	export_type::<CreateAgentProviderRequest>(&cfg)?;
	export_type::<UpdateAgentProviderRequest>(&cfg)?;
	export_type::<UpdateCodexActiveProfileRequest>(&cfg)?;
	export_type::<UpdateCodexProfileProviderRequest>(&cfg)?;
	export_type::<InferenceProviderFormatDto>(&cfg)?;
	export_type::<CreateInferenceProviderRequest>(&cfg)?;
	export_type::<UpdateInferenceProviderRequest>(&cfg)?;
	export_type::<InferenceProviderResponse>(&cfg)?;
	export_type::<InferenceProviderPasswordResponse>(&cfg)?;
	export_type::<InferenceProviderPresetResponse>(&cfg)?;
	export_type::<CodeEditorType>(&cfg)?;
	export_type::<ToolInfoDto>(&cfg)?;
	export_type::<ToolPreferencesDto>(&cfg)?;
	export_type::<OpenWithEditorRequest>(&cfg)?;
	export_type::<OpenSkillFolderRequest>(&cfg)?;
	export_type::<EditSkillFolderRequest>(&cfg)?;
	export_type::<MarketSkill>(&cfg)?;
	export_type::<TransportDto>(&cfg)?;
	export_type::<CreateMcpRequest>(&cfg)?;
	export_type::<UpdateMcpRequest>(&cfg)?;
	export_type::<McpResponse>(&cfg)?;
	export_type::<CreateSkillRequest>(&cfg)?;
	export_type::<ImportSkillRequest>(&cfg)?;
	export_type::<UpdateSkillRequest>(&cfg)?;
	export_type::<SkillResponse>(&cfg)?;
	export_type::<SkillTreeNodeKind>(&cfg)?;
	export_type::<SkillTreeNodeResponse>(&cfg)?;
	export_type::<InstallSkillRequest>(&cfg)?;
	export_type::<InstallSkillResponse>(&cfg)?;
	export_type::<SkillLockEntryResponse>(&cfg)?;
	export_type::<GlobalSkillLockResponse>(&cfg)?;
	export_type::<LocalSkillLockEntryResponse>(&cfg)?;
	export_type::<ProjectSkillLockResponse>(&cfg)?;
	export_type::<DeleteSkillByPathRequest>(&cfg)?;
	export_type::<ValidationError>(&cfg)?;
	export_type::<GitScanRequest>(&cfg)?;
	export_type::<GitScanSkillEntry>(&cfg)?;
	export_type::<GitScanResponse>(&cfg)?;
	export_type::<GitInstallRequest>(&cfg)?;
	export_type::<GitInstallResultEntry>(&cfg)?;
	export_type::<GitInstallResponse>(&cfg)?;
	export_type::<DeleteSkillByPathResponse>(&cfg)?;
	export_type::<SkillContentQuery>(&cfg)?;
	export_type::<SkillTreeQuery>(&cfg)?;
	export_type::<ProjectLockQuery>(&cfg)?;
	export_type::<InstallScopeDto>(&cfg)?;
	export_type::<TargetDto>(&cfg)?;
	export_type::<ResourceLocatorDto>(&cfg)?;
	export_type::<TransferRequest>(&cfg)?;
	export_type::<ReconcileRequest>(&cfg)?;
	export_type::<OperationActionDto>(&cfg)?;
	export_type::<OperationResultDto>(&cfg)?;
	export_type::<OperationBatchResponse>(&cfg)?;
	export_type::<GitSyncRequest>(&cfg)?;
	export_type::<GitSyncResponse>(&cfg)?;
	export_type::<CreateSubAgentRequest>(&cfg)?;
	export_type::<UpdateSubAgentRequest>(&cfg)?;
	export_type::<SubAgentResponse>(&cfg)?;
	export_type::<CCPluginResponse>(&cfg)?;
	export_type::<CCPluginScopeResponse>(&cfg)?;
	export_type::<CCPluginSourceInfoResponse>(&cfg)?;
	export_type::<CCPluginListResponse>(&cfg)?;
	export_type::<CCPluginDetailResponse>(&cfg)?;
	export_type::<CCPluginSkillInfo>(&cfg)?;
	export_type::<CCPluginManifestResponse>(&cfg)?;
	export_type::<CCPluginAuthorResponse>(&cfg)?;
	export_type::<CCPluginHooksManifestResponse>(&cfg)?;
	export_type::<CCPluginHookEventResponse>(&cfg)?;
	export_type::<CCPluginHookMatcherResponse>(&cfg)?;
	export_type::<CCPluginHookActionResponse>(&cfg)?;
	export_type::<CCPluginMcpConfigResponse>(&cfg)?;
	export_type::<CCPluginMcpServerResponse>(&cfg)?;
	export_type::<CCPluginInstallRequest>(&cfg)?;
	export_type::<CCPluginInstallResponse>(&cfg)?;
	export_type::<CCPluginUninstallRequest>(&cfg)?;
	export_type::<CCPluginUninstallResponse>(&cfg)?;
	export_type::<CCPluginUpdateRequest>(&cfg)?;
	export_type::<CCPluginUpdateResponse>(&cfg)?;
	export_type::<CCPluginOpenSkillInEditorRequest>(&cfg)?;
	export_type::<CCPluginConfigResponse>(&cfg)?;
	export_type::<CCPluginUpdateConfigRequest>(&cfg)?;
	export_type::<CCPluginMarketResponse>(&cfg)?;
	export_type::<CCMarketplaceSourceResponse>(&cfg)?;
	export_type::<CCMarketplaceEntryResponse>(&cfg)?;
	export_type::<CCMarketplaceListResponse>(&cfg)?;
	export_type::<CCMarketplaceAddRequest>(&cfg)?;
	export_type::<CCMarketplaceMutationResponse>(&cfg)?;
	export_type::<CCPluginCliStatusResponse>(&cfg)?;
	export_type::<CCPluginPruneRequest>(&cfg)?;
	export_type::<CCPluginPruneResponse>(&cfg)?;
	export_type::<CCPluginValidateRequest>(&cfg)?;
	export_type::<CCPluginValidateResponse>(&cfg)?;

	export_type::<UsageModelDto>(&cfg)?;
	export_type::<UsageDayDto>(&cfg)?;
	export_type::<UsageTotalsDto>(&cfg)?;
	export_type::<AgentUsageDto>(&cfg)?;
	export_type::<UsageReportDto>(&cfg)?;

	write_index_file(&out_dir)?;

	if disallowed_dir.exists() {
		return Err(format!(
			"DTO generation attempted to write outside the allowed output dir: {}",
			disallowed_dir.display()
		)
		.into());
	}

	Ok(())
}
