use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct SkillRepositorySourceResponse {
	pub source: String,
	pub source_type: String,
	pub source_url: String,
	pub skill_path: Option<String>,
	pub reference: Option<String>,
	pub revision: Option<String>,
	pub tree_sha: Option<String>,
	pub pinned_ref: Option<String>,
	#[ts(type = "'github_cli' | 'repository' | 'installation_lock'")]
	pub evidence: String,
	pub repository_managed: bool,
}

impl From<aghub_core::skills::source::SkillRepositorySource>
	for SkillRepositorySourceResponse
{
	fn from(source: aghub_core::skills::source::SkillRepositorySource) -> Self {
		use aghub_core::skills::source::SkillSourceEvidence;
		Self {
			source: source.source,
			source_type: source.source_type,
			source_url: source.source_url,
			skill_path: source.skill_path,
			reference: source.reference,
			revision: source.revision,
			tree_sha: source.tree_sha,
			pinned_ref: source.pinned_ref,
			evidence: match source.evidence {
				SkillSourceEvidence::GithubCli => "github_cli",
				SkillSourceEvidence::Repository => "repository",
				SkillSourceEvidence::InstallationLock => "installation_lock",
			}
			.into(),
			repository_managed: source.repository_managed,
		}
	}
}
