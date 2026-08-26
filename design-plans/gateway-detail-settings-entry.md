# 网关详情面板提供跳转 Settings 网关设置的入口

Written against: be0b31d3

## Evidence chain

- Surface: `crates/desktop/src/components/gateway/gateway-detail-panel.tsx:182-209`(头部「⋯」Dropdown)
- Problem: 网关的配置面(CLIProxyAPI 设置 / 下载源 / config.yaml)在 `/settings?tab=gateway`,但详情面板没有任何到达它的入口;用户要求「这里应该可以跳转到 setting」。
- Design evidence: Settings 页已注册 `Tabs.Tab id="gateway"`(`crates/desktop/src/pages/settings/index.tsx:44`),`?tab=gateway` 可直达;上一版 instance-row(已删)曾以 `setLocation("/settings?tab=gateway")` 提供同一跳转,证明路由通路存在。
- Owner: `gateway-detail-panel.tsx` 的「⋯」Dropdown(现仅含「删除实例」一项)。
- Scope and affected surfaces: 仅该组件;新增一条 i18n key(三语言)。
- Uncertainty: none

## Design decision

在「⋯」Dropdown 菜单中、删除项之上新增「网关设置…」项,跳转 `/settings?tab=gateway`。不在头部加独立按钮——头部按钮位已承载启停主操作,次级导航收进菜单与仓库惯例一致。

## Reuse

- `wouter` 的 `useLocation()`(仓库既有跳转方式)。
- `Dropdown.Item` 常规变体(非 danger);danger 删除项之前以 HeroUI Dropdown 的分隔(若组件支持 Separator 则加,不支持则直接并列,以现有 Dropdown 用法为准)。
- Exemplar: 已删的 `components/gateway/instance-row.tsx`(git 历史 194bc9e1)中 `setLocation("/settings?tab=gateway")` 的用法。

## Changes

1. `crates/desktop/src/components/gateway/gateway-detail-panel.tsx`
    - Change: Dropdown.Menu 的 `onAction` 增加 `settings` 分支 → `setLocation("/settings?tab=gateway")`;菜单新增 `<Dropdown.Item id="settings">{t("gatewayOpenSettings")}</Dropdown.Item>` 置于删除项上方。引入 `useLocation`。
    - Preserve: 删除项行为、danger 变体不动。
    - Verify: 菜单两项;点击「网关设置…」路由跳到 Settings 且 gateway tab 激活。
2. `crates/desktop/src/lib/locales/{en,zh-Hans,zh-Hant}.ts`
    - Change: 新增 `gatewayOpenSettings`(en: "Gateway settings…";zh-Hans: "网关设置…";zh-Hant 沿用该 locale 对 gateway 的既有译名)。
    - Verify: 三语言 key 对平,无缺失。

## Scope

- Inherit: providers 页网关详情面板。
- Verify: Settings 页 gateway tab 经 `?tab=gateway` 激活(nuqs)。
- Exclude: gateway-setup-panel(空态无实例,无设置可跳)。

## Validation

- Product: 从网关详情菜单一步到达网关设置。
- Interface: managed 与 external 实例菜单均含该项。
- System: 跳转方式与 Settings tab id 复用既有实现,无新模式。
- Repository: `cd crates/desktop && bun run typecheck && bun run lint` → 零错误。

## Stop conditions

- Stop if Settings 页 tab 状态并非 URL `?tab=` 驱动(则先确认正确的编程式激活方式再实施)。

## Design documentation

- none
