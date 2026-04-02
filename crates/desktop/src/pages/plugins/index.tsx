import { useTranslation } from "react-i18next";
import { PluginList } from "../../components/plugin-list";

export default function PluginsPage() {
	const { t } = useTranslation();

	return (
		<div className="flex flex-col h-full">
			<header className="border-b px-6 py-4">
				<h1 className="text-2xl font-semibold">{t("plugins")}</h1>
				<p className="text-muted-foreground text-sm">
					{t("pluginsDescription")}
				</p>
			</header>
			<main className="flex-1 p-4">
				<PluginList />
			</main>
		</div>
	);
}
