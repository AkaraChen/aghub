use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(crate) struct ServerListResponse {
	#[serde(default)]
	pub(crate) servers: Vec<ServerEnvelope>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServerEnvelope {
	pub(crate) server: ServerDetail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerDetail {
	pub(crate) name: String,
	#[serde(default)]
	pub(crate) description: String,
	#[serde(default)]
	pub(crate) title: Option<String>,
	#[serde(default)]
	pub(crate) version: String,
	#[serde(default)]
	pub(crate) repository: Option<Repository>,
	#[serde(default)]
	pub(crate) packages: Vec<Package>,
	#[serde(default)]
	pub(crate) remotes: Vec<Remote>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Repository {
	#[serde(default)]
	pub(crate) url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Package {
	#[serde(default)]
	pub(crate) registry_type: String,
	#[serde(default)]
	pub(crate) identifier: String,
	#[serde(default)]
	pub(crate) version: String,
	#[serde(default)]
	pub(crate) runtime_hint: Option<String>,
	#[serde(default)]
	pub(crate) transport: Option<PackageTransport>,
	#[serde(default)]
	pub(crate) runtime_arguments: Vec<Argument>,
	#[serde(default)]
	pub(crate) package_arguments: Vec<Argument>,
	#[serde(default)]
	pub(crate) environment_variables: Vec<RegistryEnvVar>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PackageTransport {
	#[serde(rename = "type", default)]
	pub(crate) transport_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Argument {
	#[serde(rename = "type", default)]
	pub(crate) arg_type: String,
	#[serde(default)]
	pub(crate) name: Option<String>,
	#[serde(default)]
	pub(crate) value_hint: Option<String>,
	#[serde(flatten)]
	pub(crate) input: RegistryInput,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistryInput {
	#[serde(default)]
	pub(crate) value: Option<String>,
	#[serde(default)]
	pub(crate) default: Option<String>,
	#[serde(default)]
	pub(crate) placeholder: Option<String>,
	#[serde(default)]
	pub(crate) description: Option<String>,
	#[serde(default)]
	pub(crate) is_required: bool,
	#[serde(default)]
	pub(crate) is_secret: bool,
	#[serde(default = "default_input_format")]
	pub(crate) format: String,
	#[serde(default)]
	pub(crate) choices: Vec<String>,
	#[serde(default)]
	pub(crate) variables: BTreeMap<String, RegistryInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistryEnvVar {
	pub(crate) name: String,
	#[serde(flatten)]
	pub(crate) input: RegistryInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Remote {
	#[serde(rename = "type", default)]
	pub(crate) transport_type: String,
	pub(crate) url: String,
	#[serde(default)]
	pub(crate) headers: Vec<RegistryHeader>,
	#[serde(default)]
	pub(crate) variables: BTreeMap<String, RegistryInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegistryHeader {
	pub(crate) name: String,
	#[serde(flatten)]
	pub(crate) input: RegistryInput,
}

fn default_input_format() -> String {
	"string".to_string()
}
