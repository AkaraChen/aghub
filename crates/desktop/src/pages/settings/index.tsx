import { useTranslation } from "react-i18next"
import { Tabs, ToggleButton, ToggleButtonGroup, Select, ListBox } from "@heroui/react"
import { ComputerDesktopIcon, SunIcon, MoonIcon } from "@heroicons/react/24/solid"
import { useTheme } from "../../providers/theme"

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
    localStorage.setItem("language", lng)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl">
        <h2 className="text-xl font-semibold mb-6">{t("settings")}</h2>

        <Tabs defaultSelectedKey="appearance">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Settings sections">
              <Tabs.Tab id="appearance">
                {t("appearance")}
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="appearance" className="pt-6">
            <div className="space-y-8">
              {/* Theme */}
              <div className="flex items-center justify-between">
                <span className="text-sm">{t("theme")}</span>
                <ToggleButtonGroup
                  selectedKeys={[theme]}
                  onSelectionChange={(keys) => setTheme([...keys][0] as "light" | "dark" | "system")}
                  selectionMode="single"
                  disallowEmptySelection
                  size="sm"
                >
                  <ToggleButton id="light" aria-label={t("light")}>
                    <SunIcon className="size-4" />
                    {t("light")}
                  </ToggleButton>
                  <ToggleButton id="dark" aria-label={t("dark")}>
                    <ToggleButtonGroup.Separator />
                    <MoonIcon className="size-4" />
                    {t("dark")}
                  </ToggleButton>
                  <ToggleButton id="system" aria-label={t("system")}>
                    <ToggleButtonGroup.Separator />
                    <ComputerDesktopIcon className="size-4" />
                    {t("system")}
                  </ToggleButton>
                </ToggleButtonGroup>
              </div>

              {/* Language */}
              <div className="flex items-center justify-between">
                <span className="text-sm">{t("language")}</span>
                <Select
                  value={i18n.language.startsWith("zh") ? "zh" : "en"}
                  onChange={(key) => changeLanguage(key as string)}
                  aria-label={t("language")}
                  className="w-40"
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="en" textValue={t("english")}>{t("english")}</ListBox.Item>
                      <ListBox.Item id="zh" textValue={t("chinese")}>{t("chinese")}</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  )
}
