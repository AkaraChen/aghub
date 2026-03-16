use serde::{Deserialize, Serialize};

/// Raw response structure for a single skill
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
	pub id: String,
	#[serde(default)]
	pub skill_id: String,
	pub name: String,
	#[serde(default)]
	pub installs: u64,
	#[serde(default)]
	pub source: String,
}

/// API response structure
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchResponse {
	pub skills: Vec<Skill>,
}

/// User-friendly skill representation (mapped format)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SearchResult {
	pub name: String,
	pub slug: String,
	pub source: String,
	pub installs: u64,
}

impl From<Skill> for SearchResult {
	fn from(skill: Skill) -> Self {
		let slug = if skill.skill_id.is_empty() {
			skill.id.clone()
		} else {
			skill.skill_id
		};
		Self {
			name: skill.name,
			slug,
			source: skill.source,
			installs: skill.installs,
		}
	}
}

/// Search parameters
#[derive(Debug, Clone, Default)]
pub struct SearchParams {
	pub query: String,
	pub limit: Option<usize>,
}

impl SearchParams {
	pub fn new(query: impl Into<String>) -> Self {
		Self {
			query: query.into(),
			limit: None,
		}
	}

	pub fn with_limit(mut self, limit: usize) -> Self {
		self.limit = Some(limit);
		self
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_search_params_new() {
		let params = SearchParams::new("git");
		assert_eq!(params.query, "git");
		assert_eq!(params.limit, None);
	}

	#[test]
	fn test_search_params_with_limit() {
		let params = SearchParams::new("docker").with_limit(5);
		assert_eq!(params.query, "docker");
		assert_eq!(params.limit, Some(5));
	}

	#[test]
	fn test_search_params_default() {
		let params = SearchParams::default();
		assert_eq!(params.query, "");
		assert_eq!(params.limit, None);
	}

	#[test]
	fn test_skill_to_search_result() {
		let skill = Skill {
			id: "github/awesome-copilot/git-skill".to_string(),
			skill_id: "git-skill".to_string(),
			name: "Git".to_string(),
			installs: 1000,
			source: "github".to_string(),
		};

		let result: SearchResult = skill.into();

		assert_eq!(result.name, "Git");
		assert_eq!(result.slug, "git-skill");
		assert_eq!(result.source, "github");
		assert_eq!(result.installs, 1000);
	}

	#[test]
	fn test_skill_deserialization_with_defaults() {
		let json = r#"{"id": "test", "name": "Test Skill"}"#;
		let skill: Skill = serde_json::from_str(json).unwrap();

		assert_eq!(skill.id, "test");
		assert_eq!(skill.name, "Test Skill");
		assert_eq!(skill.installs, 0);
		assert_eq!(skill.source, "");
	}

	#[test]
	fn test_search_response_deserialization() {
		let json = r#"{
            "query": "test",
            "searchType": "fuzzy",
            "skills": [
                {"id": "github/org/skill1", "skillId": "skill1", "name": "Skill 1", "installs": 100, "source": "github/org"},
                {"id": "github/org/skill2", "skillId": "skill2", "name": "Skill 2", "installs": 50, "source": "github/org"}
            ],
            "count": 2,
            "duration_ms": 10
        }"#;

		let response: SearchResponse = serde_json::from_str(json).unwrap();
		assert_eq!(response.skills.len(), 2);
		assert_eq!(response.skills[0].name, "Skill 1");
		assert_eq!(response.skills[0].skill_id, "skill1");
		assert_eq!(response.skills[1].installs, 50);
	}
}
