"use client";

import { useReducer } from "react";
import type { CCPluginResponse } from "../../generated/dto";

type PluginScopeValue = "user" | "project" | "local";

interface PluginScopeSelection {
	pluginId: string;
	scope: PluginScopeValue;
}

interface PluginsPageState {
	searchQuery: string;
	selectedPluginId: string | null;
	selectedKeys: Set<string>;
	isMultiSelectMode: boolean;
	selectedPluginScope: PluginScopeSelection | null;
	isMarketDialogOpen: boolean;
	isBulkUninstallDialogOpen: boolean;
}

type PluginsPageAction =
	| {
			type: "set-selection";
			keys: Set<string>;
			clickedKey?: string;
	  }
	| {
			type: "toggle-multi-select";
	  }
	| {
			type: "patch";
			value: Partial<PluginsPageState>;
	  }
	| {
			type: "clear-after-bulk-uninstall";
			removedPluginIds: Set<string>;
			nextPluginId: string | null;
	  };

function createInitialState(plugins: CCPluginResponse[]): PluginsPageState {
	return {
		searchQuery: "",
		selectedPluginId: plugins[0]?.id ?? null,
		selectedKeys: new Set<string>(),
		isMultiSelectMode: false,
		selectedPluginScope: null,
		isMarketDialogOpen: false,
		isBulkUninstallDialogOpen: false,
	};
}

function reduceSelection(
	state: PluginsPageState,
	keys: Set<string>,
	clickedKey?: string,
): PluginsPageState {
	let selectedPluginId = state.selectedPluginId;
	let isMultiSelectMode = state.isMultiSelectMode;

	if (clickedKey && !state.isMultiSelectMode) {
		selectedPluginId = clickedKey;
	} else if (keys.size === 1 && !state.isMultiSelectMode) {
		selectedPluginId = [...keys][0] ?? null;
	} else if (keys.size === 0 && !state.isMultiSelectMode) {
		selectedPluginId = null;
	}

	if (keys.size > 1 && !state.isMultiSelectMode) {
		isMultiSelectMode = true;
	}
	if (keys.size === 0 && state.isMultiSelectMode) {
		isMultiSelectMode = false;
	}

	return {
		...state,
		selectedKeys: keys,
		selectedPluginId,
		isMultiSelectMode,
	};
}

function reducer(
	state: PluginsPageState,
	action: PluginsPageAction,
): PluginsPageState {
	switch (action.type) {
		case "set-selection":
			return reduceSelection(state, action.keys, action.clickedKey);
		case "toggle-multi-select":
			if (state.isMultiSelectMode) {
				return {
					...state,
					selectedKeys: new Set<string>(),
					isMultiSelectMode: false,
				};
			}

			return {
				...state,
				isMultiSelectMode: true,
			};
		case "patch":
			return {
				...state,
				...action.value,
			};
		case "clear-after-bulk-uninstall":
			return {
				...state,
				selectedKeys: new Set<string>(),
				isMultiSelectMode: false,
				selectedPluginScope: null,
				isBulkUninstallDialogOpen: false,
				selectedPluginId:
					state.selectedPluginId &&
					!action.removedPluginIds.has(state.selectedPluginId)
						? state.selectedPluginId
						: action.nextPluginId,
			};
	}
}

export function usePluginsPageState(plugins: CCPluginResponse[]) {
	const [state, dispatch] = useReducer(reducer, plugins, createInitialState);
	const firstPluginId = plugins[0]?.id ?? null;
	const patchState = (value: Partial<PluginsPageState>) =>
		dispatch({
			type: "patch",
			value,
		});
	const validPluginIds = new Set(plugins.map((plugin) => plugin.id));
	const activeSelectedPluginId =
		state.selectedPluginId && validPluginIds.has(state.selectedPluginId)
			? state.selectedPluginId
			: firstPluginId;
	const selectedPlugin =
		plugins.find((plugin) => plugin.id === activeSelectedPluginId) ?? null;
	const marketInstallScope =
		selectedPlugin &&
		state.selectedPluginScope?.pluginId === selectedPlugin.id &&
		selectedPlugin.scopes.some(
			(scope) => scope.scope === state.selectedPluginScope?.scope,
		)
			? state.selectedPluginScope.scope
			: ((selectedPlugin?.display_scope ??
					selectedPlugin?.scopes[0]?.scope ??
					"user") as PluginScopeValue);
	const sortedPlugins = [...plugins].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	const selectedKeysInPlugins = new Set(
		[...state.selectedKeys].filter((pluginId) =>
			validPluginIds.has(pluginId),
		),
	);
	const effectiveSelectedKeys =
		selectedKeysInPlugins.size > 0 && state.isMultiSelectMode
			? selectedKeysInPlugins
			: activeSelectedPluginId
				? new Set([activeSelectedPluginId])
				: new Set<string>();
	const selectedPlugins = plugins.filter((plugin) =>
		selectedKeysInPlugins.has(plugin.id),
	);

	return {
		searchQuery: state.searchQuery,
		setSearchQuery: (value: string) =>
			patchState({
				searchQuery: value,
			}),
		sortedPlugins,
		selectedPlugin,
		marketInstallScope,
		selectedKeysInPlugins,
		effectiveSelectedKeys,
		selectedPlugins,
		isMultiSelectMode: state.isMultiSelectMode,
		isMarketDialogOpen: state.isMarketDialogOpen,
		isBulkUninstallDialogOpen: state.isBulkUninstallDialogOpen,
		activeSelectedPluginId,
		handleSelectionChange: (keys: Set<string>, clickedKey?: string) =>
			dispatch({
				type: "set-selection",
				keys,
				clickedKey,
			}),
		openMarketDialog: () =>
			patchState({
				isMarketDialogOpen: true,
			}),
		closeMarketDialog: () =>
			patchState({
				isMarketDialogOpen: false,
			}),
		toggleMultiSelect: () =>
			dispatch({
				type: "toggle-multi-select",
			}),
		openBulkUninstallDialog: () =>
			patchState({
				isBulkUninstallDialogOpen: true,
			}),
		setBulkUninstallDialogOpen: (open: boolean) =>
			patchState({
				isBulkUninstallDialogOpen: open,
			}),
		setSelectedPluginScope: (pluginId: string, scope: PluginScopeValue) =>
			patchState({
				selectedPluginScope: {
					pluginId,
					scope,
				},
			}),
		clearBulkSelectionAfterUninstall: (removedPluginIds: Set<string>) =>
			dispatch({
				type: "clear-after-bulk-uninstall",
				removedPluginIds,
				nextPluginId:
					plugins.find((plugin) => !removedPluginIds.has(plugin.id))
						?.id ?? null,
			}),
	};
}
