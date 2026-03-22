import { ToggleButton, ToggleButtonGroup } from "@heroui/react"
import { ComputerDesktopIcon, SunIcon, MoonIcon } from "@heroicons/react/24/solid"
import { useTheme } from "../../providers/theme"

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-3xl">
        <h2 className="text-xl font-semibold mb-6">Settings</h2>

        <div className="space-y-6">
          {/* Appearance */}
          <div>
            <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Appearance</h3>
            <div className="flex items-center justify-between">
              <span className="text-sm">Theme</span>
              <ToggleButtonGroup
                selectedKeys={[theme]}
                onSelectionChange={(keys) => setTheme([...keys][0] as "light" | "dark" | "system")}
                selectionMode="single"
                disallowEmptySelection
                size="sm"
              >
                <ToggleButton id="light" aria-label="Light mode">
                  <SunIcon className="size-4" />
                  Light
                </ToggleButton>
                <ToggleButton id="dark" aria-label="Dark mode">
                  <ToggleButtonGroup.Separator />
                  <MoonIcon className="size-4" />
                  Dark
                </ToggleButton>
                <ToggleButton id="system" aria-label="System mode">
                  <ToggleButtonGroup.Separator />
                  <ComputerDesktopIcon className="size-4" />
                  System
                </ToggleButton>
              </ToggleButtonGroup>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
