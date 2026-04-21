mod common;
mod detail;
mod lifecycle;
mod market;

pub use common::{
	CCPluginAuthorResponse, CCPluginConfigResponse, CCPluginMcpConfigResponse,
	CCPluginMcpServerResponse, CCPluginResponse, CCPluginScopeResponse,
	CCPluginSkillInfo, CCPluginSourceInfoResponse,
};
pub use detail::{
	CCPluginDetailResponse, CCPluginHookActionResponse,
	CCPluginHookEventResponse, CCPluginHookMatcherResponse,
	CCPluginHooksManifestResponse, CCPluginManifestResponse,
};
pub use lifecycle::{
	CCPluginCheckUpdateRequest, CCPluginCheckUpdateResponse,
	CCPluginInstallRequest, CCPluginInstallResponse, CCPluginListResponse,
	CCPluginOpenSkillInEditorRequest, CCPluginReinstallRequest,
	CCPluginReinstallResponse, CCPluginUninstallRequest,
	CCPluginUninstallResponse, CCPluginUpdateConfigRequest,
	CCPluginUpdateRequest, CCPluginUpdateResponse,
};
pub use market::CCPluginMarketResponse;
