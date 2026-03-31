export type CredentialType = "github";

export interface GitHubCredential {
	id: string;
	name: string;
	email: string;
	token: string;
}

export interface Credential {
	id: string;
	type: CredentialType;
	data: GitHubCredential;
}

export const SECRETS_VERSION_KEY = "__version__";
export const SECRETS_CURRENT_VERSION = 1;
