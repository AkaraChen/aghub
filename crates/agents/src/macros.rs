//! Macros for generating agent path helper functions.
//!
//! These macros reduce boilerplate in agent descriptor files by generating
//! common path and I/O functions.

// ── MCP Path Macros ──────────────────────────────────────────────────────────

/// Macro to generate MCP path helper functions for an agent descriptor.
///
/// Generates the following functions:
/// - `mcp_global_path()` - returns global MCP config path
/// - `mcp_project_path(root)` - returns project MCP config path
/// - `global_data_dir()` - returns global data directory (parent of mcp_global)
/// - `load_mcps(project_root, scope)` - loads MCPs for scope
/// - `save_mcps(project_root, scope, mcps)` - saves MCPs for scope
///
/// # Symmetric variant (same base path for global and project)
/// ```rust,ignore
/// define_mcp_paths! {
///     symmetric: ".claude/settings.json",
///     strategy: mcp_strategy::parse_json_map_mcp_servers,
///               mcp_strategy::serialize_json_map_mcp_servers,
/// }
/// ```
///
/// # Asymmetric variant (different paths for global and project)
/// ```rust,ignore
/// define_mcp_paths! {
///     global: ".codeium/windsurf/mcp_config.json",
///     project: ".windsurf/mcp_config.json",
///     data_dir: ".codeium/windsurf",
///     strategy: mcp_strategy::parse_json_map_mcp_servers,
///               mcp_strategy::serialize_json_map_mcp_servers,
/// }
/// ```
#[macro_export]
macro_rules! define_mcp_paths {
	// Symmetric variant - same path relative to home and project
	(
		symmetric: $path:literal,
		strategy: $parse_fn:path, $serialize_fn:path,
	) => {
		fn mcp_global_path() -> Option<std::path::PathBuf> {
			$crate::descriptor::home_dir().map(|home| home.join($path))
		}
		fn mcp_project_path(
			root: &std::path::Path,
		) -> Option<std::path::PathBuf> {
			Some(root.join($path))
		}
		fn global_data_dir() -> Option<std::path::PathBuf> {
			$crate::descriptor::home_dir()
				.map(|home| home.join($path).parent().unwrap().to_path_buf())
		}
		fn load_mcps(
			project_root: Option<&std::path::Path>,
			scope: $crate::ResourceScope,
		) -> $crate::Result<Vec<$crate::McpServer>> {
			$crate::descriptor::load_scoped_mcps(
				project_root,
				scope,
				Some(mcp_global_path),
				Some(mcp_project_path),
				$parse_fn,
			)
		}
		fn save_mcps(
			project_root: Option<&std::path::Path>,
			scope: $crate::ResourceScope,
			mcps: &[$crate::McpServer],
		) -> $crate::Result<()> {
			$crate::descriptor::save_scoped_mcps(
				project_root,
				scope,
				mcps,
				Some(mcp_global_path),
				Some(mcp_project_path),
				$serialize_fn,
			)
		}
	};

	// Asymmetric variant - different paths for global and project
	(
		global: $global_path:literal,
		project: $project_path:literal,
		data_dir: $data_dir:literal,
		strategy: $parse_fn:path, $serialize_fn:path,
	) => {
		fn mcp_global_path() -> Option<std::path::PathBuf> {
			$crate::descriptor::home_dir().map(|home| home.join($global_path))
		}
		fn mcp_project_path(
			root: &std::path::Path,
		) -> Option<std::path::PathBuf> {
			Some(root.join($project_path))
		}
		fn global_data_dir() -> Option<std::path::PathBuf> {
			$crate::descriptor::home_dir().map(|home| home.join($data_dir))
		}
		fn load_mcps(
			project_root: Option<&std::path::Path>,
			scope: $crate::ResourceScope,
		) -> $crate::Result<Vec<$crate::McpServer>> {
			$crate::descriptor::load_scoped_mcps(
				project_root,
				scope,
				Some(mcp_global_path),
				Some(mcp_project_path),
				$parse_fn,
			)
		}
		fn save_mcps(
			project_root: Option<&std::path::Path>,
			scope: $crate::ResourceScope,
			mcps: &[$crate::McpServer],
		) -> $crate::Result<()> {
			$crate::descriptor::save_scoped_mcps(
				project_root,
				scope,
				mcps,
				Some(mcp_global_path),
				Some(mcp_project_path),
				$serialize_fn,
			)
		}
	};
}

// ── Skill Path Macros ──────────────────────────────────────────────────────────

/// Macro to generate skill path helper functions for an agent descriptor.
///
/// Generates the following functions:
/// - `global_skills_paths()` - returns global skills read paths
/// - `project_skills_paths(root)` - returns project skills read paths
/// - `global_skill_write_path()` - returns global skills write path
/// - `project_skill_write_path(root)` - returns project skills write path
///
/// # Symmetric variant (same path relative to home and project)
/// ```rust,ignore
/// define_skill_paths! {
///     symmetric: ".claude/skills",
/// }
/// ```
///
/// # Asymmetric variant (different paths for global and project)
/// ```rust,ignore
/// define_skill_paths! {
///     global: ".codeium/windsurf/skills",
///     project: ".windsurf/skills",
/// }
/// ```
#[macro_export]
macro_rules! define_skill_paths {
	// Symmetric variant - same path relative to home and project
	(
		symmetric: $path:literal,
	) => {
		fn global_skills_paths() -> Vec<std::path::PathBuf> {
			match $crate::descriptor::home_dir() {
				Some(home) => vec![home.join($path)],
				None => Vec::new(),
			}
		}
		fn project_skills_paths(
			root: &std::path::Path,
		) -> Vec<std::path::PathBuf> {
			vec![root.join($path)]
		}
		fn global_skill_write_path() -> Option<std::path::PathBuf> {
			$crate::descriptor::home_dir().map(|home| home.join($path))
		}
		fn project_skill_write_path(
			root: &std::path::Path,
		) -> Option<std::path::PathBuf> {
			Some(root.join($path))
		}
	};

	// Asymmetric variant - different paths for global and project
	(
		global: $global_path:literal,
		project: $project_path:literal,
	) => {
		fn global_skills_paths() -> Vec<std::path::PathBuf> {
			match $crate::descriptor::home_dir() {
				Some(home) => vec![home.join($global_path)],
				None => Vec::new(),
			}
		}
		fn project_skills_paths(
			root: &std::path::Path,
		) -> Vec<std::path::PathBuf> {
			vec![root.join($project_path)]
		}
		fn global_skill_write_path() -> Option<std::path::PathBuf> {
			$crate::descriptor::home_dir().map(|home| home.join($global_path))
		}
		fn project_skill_write_path(
			root: &std::path::Path,
		) -> Option<std::path::PathBuf> {
			Some(root.join($project_path))
		}
	};
}
