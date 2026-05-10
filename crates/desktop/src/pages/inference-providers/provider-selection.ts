export function selectValidProviderId(
	currentProviderId: string,
	providers: Array<{ id: string }>,
	defaultProviderId: string,
) {
	return providers.some((provider) => provider.id === currentProviderId)
		? currentProviderId
		: defaultProviderId;
}
