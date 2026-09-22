use crate::{AgentDescriptor, AgentSurface, AgentSurfaceKind};
use log::{debug, info};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectionState {
	Detected,
	NotDetected,
	Unknown,
	Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectionProbeKind {
	Command,
	Path,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeResult {
	Detected,
	Absent,
	Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectionEvidence {
	pub kind: DetectionProbeKind,
	pub target: String,
	pub result: ProbeResult,
	pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigurationEvidence {
	pub path: String,
	pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceAvailability {
	pub surface_id: &'static str,
	pub kind: AgentSurfaceKind,
	pub state: DetectionState,
	pub configured: bool,
	pub evidence: Vec<DetectionEvidence>,
	pub configuration: Vec<ConfigurationEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailabilityInfo {
	pub agent_id: &'static str,
	pub state: DetectionState,
	pub configured: bool,
	pub surfaces: Vec<SurfaceAvailability>,
}

fn format_path(path: &std::path::Path) -> String {
	crate::format_path_with_tilde(path)
		.unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn check_command(command: &str) -> DetectionEvidence {
	match which::which(command) {
		Ok(path) => DetectionEvidence {
			kind: DetectionProbeKind::Command,
			target: command.to_string(),
			result: ProbeResult::Detected,
			detail: Some(format_path(&path)),
		},
		Err(which::Error::CannotFindBinaryPath) => DetectionEvidence {
			kind: DetectionProbeKind::Command,
			target: command.to_string(),
			result: ProbeResult::Absent,
			detail: None,
		},
		Err(error) => DetectionEvidence {
			kind: DetectionProbeKind::Command,
			target: command.to_string(),
			result: ProbeResult::Error,
			detail: Some(error.to_string()),
		},
	}
}

fn check_runtime_path(
	resolve: crate::descriptor::OptionalPathFn,
) -> Option<DetectionEvidence> {
	let path = resolve()?;
	Some(DetectionEvidence {
		kind: DetectionProbeKind::Path,
		target: format_path(&path),
		result: if path.exists() {
			ProbeResult::Detected
		} else {
			ProbeResult::Absent
		},
		detail: None,
	})
}

fn check_configuration(
	resolve: crate::descriptor::OptionalPathFn,
) -> Option<ConfigurationEvidence> {
	let path = resolve()?;
	Some(ConfigurationEvidence {
		exists: path.exists(),
		path: format_path(&path),
	})
}

fn summarize_detection(
	results: &[ProbeResult],
	_configured: bool,
) -> DetectionState {
	if results.contains(&ProbeResult::Detected) {
		DetectionState::Detected
	} else if results.contains(&ProbeResult::Error) {
		DetectionState::Error
	} else if results.is_empty() {
		DetectionState::Unknown
	} else {
		DetectionState::NotDetected
	}
}

fn check_surface(surface: &AgentSurface) -> SurfaceAvailability {
	let mut evidence = surface
		.cli_names
		.iter()
		.map(|command| check_command(command))
		.collect::<Vec<_>>();
	evidence.extend(
		surface
			.runtime_paths
			.iter()
			.filter_map(|resolve| check_runtime_path(*resolve)),
	);
	let configuration = surface
		.configuration_paths
		.iter()
		.filter_map(|resolve| check_configuration(*resolve))
		.collect::<Vec<_>>();
	let configured = configuration.iter().any(|entry| entry.exists);
	let results = evidence
		.iter()
		.map(|entry| entry.result)
		.collect::<Vec<_>>();

	SurfaceAvailability {
		surface_id: surface.id,
		kind: surface.kind,
		state: summarize_detection(&results, configured),
		configured,
		evidence,
		configuration,
	}
}

fn summarize_product(surfaces: &[SurfaceAvailability]) -> DetectionState {
	let states = surfaces
		.iter()
		.map(|surface| surface.state)
		.collect::<Vec<_>>();
	if states.contains(&DetectionState::Detected) {
		DetectionState::Detected
	} else if states.contains(&DetectionState::Error) {
		DetectionState::Error
	} else if states.contains(&DetectionState::Unknown) || states.is_empty() {
		DetectionState::Unknown
	} else {
		DetectionState::NotDetected
	}
}

pub fn check_agent_availability(
	descriptor: &AgentDescriptor,
) -> AvailabilityInfo {
	let surfaces = descriptor
		.surfaces
		.iter()
		.map(check_surface)
		.collect::<Vec<_>>();
	let configured = surfaces.iter().any(|surface| surface.configured);
	let state = summarize_product(&surfaces);
	debug!(
		"availability for agent '{}': state={:?}, configured={}",
		descriptor.id, state, configured
	);

	AvailabilityInfo {
		agent_id: descriptor.id,
		state,
		configured,
		surfaces,
	}
}

pub fn check_all_agents_availability() -> Vec<AvailabilityInfo> {
	use std::thread;

	let descriptors: Vec<&AgentDescriptor> =
		crate::registry::iter_all().collect();
	info!("checking availability for {} agents", descriptors.len());

	let handles = descriptors
		.into_iter()
		.map(|descriptor| {
			thread::spawn(move || check_agent_availability(descriptor))
		})
		.collect::<Vec<_>>();
	let results = handles
		.into_iter()
		.map(|handle| handle.join().expect("availability probe panicked"))
		.collect::<Vec<_>>();
	info!("completed availability checks for {} agents", results.len());
	results
}

#[cfg(test)]
mod tests {
	use super::*;

	fn unresolved_path() -> Option<std::path::PathBuf> {
		None
	}

	#[test]
	fn configured_files_do_not_count_as_runtime_detection() {
		let state = summarize_detection(&[ProbeResult::Absent], true);

		assert_eq!(state, DetectionState::NotDetected);
	}

	#[test]
	fn surfaces_without_runtime_probes_stay_unknown() {
		assert_eq!(summarize_detection(&[], false), DetectionState::Unknown);
	}

	#[test]
	fn unavailable_platform_runtime_paths_leave_surface_unknown() {
		let surface = AgentSurface::desktop("desktop", &[unresolved_path], &[]);

		let result = check_surface(&surface);

		assert_eq!(result.state, DetectionState::Unknown);
		assert!(result.evidence.is_empty());
	}

	#[test]
	fn one_detected_alias_detects_the_surface() {
		let state = summarize_detection(
			&[ProbeResult::Absent, ProbeResult::Detected],
			false,
		);

		assert_eq!(state, DetectionState::Detected);
	}

	#[test]
	fn probe_errors_are_not_reduced_to_not_detected() {
		let state = summarize_detection(
			&[ProbeResult::Absent, ProbeResult::Error],
			false,
		);

		assert_eq!(state, DetectionState::Error);
	}

	#[test]
	fn cursor_keeps_cli_and_ide_detection_separate() {
		let descriptor = crate::registry::get(crate::AgentType::Cursor);
		let info = check_agent_availability(descriptor);

		assert_eq!(info.agent_id, "cursor");
		assert_eq!(info.surfaces.len(), 3);
		assert!(info
			.surfaces
			.iter()
			.any(|surface| surface.kind == AgentSurfaceKind::Cli));
		assert!(info
			.surfaces
			.iter()
			.any(|surface| surface.kind == AgentSurfaceKind::Ide));
		assert!(info.surfaces.iter().any(|surface| {
			surface.kind == AgentSurfaceKind::Cloud
				&& surface.state == DetectionState::Unknown
		}));
	}

	#[test]
	fn all_registered_agents_have_surface_results() {
		let results = check_all_agents_availability();

		assert!(!results.is_empty());
		assert!(results.iter().all(|info| !info.surfaces.is_empty()));
	}
}
