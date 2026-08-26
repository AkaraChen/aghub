# 删除网关详情面板底部的镜像条目提示行

Written against: be0b31d3

## Evidence chain

- Surface: `crates/desktop/src/components/gateway/gateway-detail-panel.tsx:276-278`(providers 页右栏,选中网关实例时)
- Problem: 面板底部固定一行 border-t 的 muted 文案「镜像条目「…」与「… (OpenAI)」在左侧推理 Provider 分组,绑定 agent 在那里进行。」用户明确否决(「不要」)。
- Design evidence: 用户直接指令(element picker 指向该 `<p>`);该行也是右栏内唯一带 border-t 的常驻页脚,页面其他详情面板(ProviderDetail)无此形态。
- Owner: `gateway-detail-panel.tsx`
- Scope and affected surfaces: 仅该组件;i18n key `gatewayMirrorFootnote` 为其唯一消费者(en/zh-Hans/zh-Hant 各一条)。
- Uncertainty: none

## Design decision

整行删除,不保留任何替代提示——镜像条目在左栏列表可见,自解释。

## Reuse

- 无需新引入任何元素。
- Exemplar: n/a(纯删除)

## Changes

1. `crates/desktop/src/components/gateway/gateway-detail-panel.tsx`
    - Change: 删除 276-278 行的 `<p className="shrink-0 border-t …">{t("gatewayMirrorFootnote", …)}</p>`;外层 `flex h-full flex-col` 结构保留。
    - Preserve: 滚动容器与 DeleteGatewayInstanceDialog 不动。
    - Verify: 详情面板底部无页脚行,内容区直达底边。
2. `crates/desktop/src/lib/locales/{en,zh-Hans,zh-Hant}.ts`
    - Change: 删除 `gatewayMirrorFootnote` 条目(三语言)。
    - Preserve: 相邻 key 顺序不重排。
    - Verify: 全库 `grep gatewayMirrorFootnote` 零命中。

## Scope

- Inherit: providers 页网关详情面板(唯一消费者)。
- Verify: 无其他引用(已 grep 确认)。
- Exclude: Settings 网关 panel、accounts-drawer——均未引用该 key。

## Validation

- Product: 选中网关实例,详情面板不再出现底部提示行。
- Interface: running 与非 running 两种状态下面板底部均无页脚。
- System: 无新增平行模式(纯删除)。
- Repository: `cd crates/desktop && bun run typecheck && bun run lint` → 零错误;`grep -rn gatewayMirrorFootnote src` → 无输出。

## Stop conditions

- Stop if `gatewayMirrorFootnote` 出现第二个消费者(说明本计划证据过期)。

## Design documentation

- none
