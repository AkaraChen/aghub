# 资源列表交互 v2 — 实施 spec

状态:已实施(A–F 全量,单 PR 汇总)。B6 真机清单待用户逐条勾选;拖拽拦截假设验证(A5)已由 dnd-kit 路线绕开,无需执行。

## 0. 背景与已锁定决策

PR #322 落地了选择模型(单一 `selectedKeys` 真相源)+ 动作层(`use-resource-actions`)+ 28 e2e。本轮在此地基上补齐四个面:右键、拖拽、多选面板、键盘。

| 决策点   | 结论                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 拖拽路线 | **1b'**:先真机验证「Tauri dragDropEnabled 拦截」假设(半小时,不合入),然后迁移 **dnd-kit**(pointer 系)                                          |
| 面板形态 | **2c**:batch inspector 三段布局,两期交付(骨架 → agent 覆盖矩阵)                                                                               |
| 键盘范围 | **3b** 标准集:Cmd+A / Esc / 空白点击清除 / Delete / F2;跨段方向键桥**不做**(记为 v3 候选)                                                     |
| 契约固化 | **4a** 双层:通用哲学 skill(新建 GitHub 仓库存放)+ repo 内 `docs/interaction-model.md`;**均先本地成稿待审,审过前不建仓库、不 commit、不 push** |

**总原则(投影原则)**:菜单、面板、拖拽、键盘是同一动作层(`use-resource-actions`)的四个投影。任何新动作先进动作层,再各自投影;禁止某个入口私有一个动作实现。选择模型不动。

## 1. 分期总览

| PR  | 主题            | 内容                                                                                                                                  | 预估       |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A   | 修正与假设验证  | 菜单点选即关、动作图标统一映射、disable-vs-hide、拖拽拦截真机验证(gate)、**动效地基**(token/reduced-motion/折叠动画)                  | 1-1.5 天   |
| B   | 拖拽迁移        | dnd-kit 接线 + 五件套体验(拖影/徽章/spring-loading/auto-scroll/落点反馈)+ **右侧拖放板(双落面)** + VT-1 位置连续动画 + e2e 改真实驱动 | 3-4.5 天   |
| C   | 面板骨架        | batch inspector 三段布局 + roster(单项移出/徽章)+ 动作分区(矩阵位置放「管理 Agents」按钮)+ 面板过渡 + 分组头吸顶                      | 1.5-2 天   |
| D   | 面板矩阵        | agent 覆盖矩阵就地批量装卸,替换占位按钮                                                                                               | 2 天       |
| E   | 键盘 + 右键补全 | 标准集键盘、空白区菜单、分组头成员动作、菜单 kbd 提示列                                                                               | 1.5-2.5 天 |
| F   | 契约固化        | `docs/interaction-model.md` + 通用 skill 草稿(本地待审)                                                                               | 0.5-1 天   |

依赖:B 依赖 A 的验证结论;D 依赖 C;E、F 独立可并行于 C/D。每个 PR 独立可回滚,合入门槛见 §8。

---

## 2. PR-A 修正与假设验证

### A1 菜单点选即关

现状:`context-menu.tsx` 的 `PopoverContent` 只有 outside-close,点菜单项后菜单滞留。

- 改法:`ContextMenu` 内的 `<Menu>` 加 Menu 级 `onAction={() => onClose()}`(item 级 onAction 照常执行,Menu 级统一收口关闭)。
- 涉及:`src/components/context-menu.tsx`(单点改,所有消费方自动获益)。
- e2e:`context menu closes after choosing an action`——右键 → 点「收藏」→ 断言菜单隐藏且动作生效。**有牙验证**:注释掉 onAction 收口,该用例应红。

### A2 动作图标统一映射

现状:transfer 在菜单是 `CodeBracketIcon`,在面板是 `PlusIcon`。

- 改法:新建 `src/components/action-icons.ts`,导出 `ACTION_ICONS: Record<动作名, HeroIcon>` 单一映射(addToAgent=Plus、transfer=ArrowsRightLeft、favorite=Star/StarOutline、moveToGroup=Folder、createGroup=FolderPlus、removeFromGroup=FolderMinus、delete=Trash)。菜单(skill-list/mcp-list)与面板(bulk-actions-panel)一律从映射取。
- 验收:grep 两个列表与面板,不再出现动作图标的字面引用。

### A3 disable-vs-hide

- 「移出分组」:`canRemoveFromGroup=false` 时改为 **disabled** 菜单项(现为隐藏),菜单结构稳定可预期(HIG)。
- 「移到分组」无分组时维持现状(只显示顶层「新建分组」)——该情形属于「整个区不适用」,隐藏合理。
- e2e:选中未分组项右键 → 断言「移出分组」存在且 `aria-disabled`。

### A4 动效地基

- `theme.css` 增加动效 token(§10.2)+ 全局 `prefers-reduced-motion` 覆盖(时长归零);Playwright config 增加 `use: { reducedMotion: "reduce" }`。
- 分组展开/折叠动画:外层 `grid-template-rows` 0fr↔1fr(`--dur-base`)+ 内层 overflow-hidden——**复活** index.css 里已存在但无人使用的 `grid-rows-expand/collapse` 工具类(或改内联后删除死代码,二选一,不留两份)。
- chevron 由双图标互换改为**单图标 rotate**(-90°↔0,`--dur-fast`)——图标互换无法过渡。
- 列表项 / 分组头选中态背景加 `--dur-fast` 过渡。
- e2e:reduce 下动画瞬时完成,既有折叠用例断言不变;另加一条断言 reduce 生效(computed transition-duration 为 0s)。

### A5 拖拽拦截假设验证(gate,不合入代码)

步骤(真机执行,结论写入 PR-B 描述):

1. 现状确认:skills 页按住列表项拖动 → 预期毫无反应(无拖影)。
2. 临时在 `src-tauri/tauri.conf.json` 的 window 配置加 `"dragDropEnabled": false`,重启 `bun run start`。
3. 再拖 → 预期 HTML5 拖拽恢复(出现系统拖影,分组 section 出现 ring 高亮)。
4. **回滚该配置**(dnd-kit 路线不需要它)。

Gate:若第 3 步仍无反应,**停止 PR-B,回报**——说明拦截假设不成立,另有原因(react-aria 版本/事件被上层吃掉),PR-B 的方案基础需要重估。

---

## 3. PR-B 拖拽迁移 dnd-kit

### B1 依赖与结构

- 新增依赖:`@dnd-kit/core`(锁版本)。不引 sortable/modifiers(当前无排序需求)。
- `DndContext` 提升到**页面级**(skills.tsx / mcp-servers.tsx)——拖拽域必须同时覆盖列表面板与右侧面板(拖放板要求同一 context)。`sensors: [PointerSensor({ activationConstraint: { distance: 8 } })]`,碰撞检测 `pointerWithin`。列表组件经 context 感知拖拽态,不自建 DndContext。
- 移除:两个列表的 react-aria `useDragAndDrop`/`dragAndDropHooks`、`resource-group-section.tsx` 的 `useDrag` + `DropZone`、`readDraggedKeys`、`SKILL_DRAG_TYPE`/MCP 同类 MIME 常量。**保留** `dragSelectionPayload`(纯函数+单测,dnd-kit 的 drag data 直接复用)。

### B2 拖拽源

- 列表项:行内容 div 挂 `useDraggable({ id: key, data: { keys: dragSelectionPayload([key], selectedKeys) } })`。
- 分组头:同样 `useDraggable`,data.keys = 成员全集(现状语义)。
- 与 react-aria 手势共存:8px 阈值内是点击(选择照常);启动拖拽后置 `isDraggingRef`,选择 handler 在拖拽期间忽略变更(防止 press 误触)。**此点必须真机验证**(§B6 清单第 2 条)。

### B3 落点

| 目标                      | id                 | 行为                                            |
| ------------------------- | ------------------ | ----------------------------------------------- |
| 自定义分组 section(头+体) | `group:{id}`       | `assignMembers(keys, id)`                       |
| 未分组区                  | `ungrouped`        | `unassignMembers(keys)`                         |
| 新建分组 zone             | `new-group`        | `onDropCreateGroup(keys)`                       |
| source 分组               | 不注册             | 不可落(现状一致)                                |
| 拖放板 · 分组卡           | `board:group:{id}` | 同 `group:{id}`(同一 handler)                   |
| 拖放板 · 新建分组卡       | `board:new-group`  | 同 `new-group`                                  |
| 拖放板 · 未分组卡         | `board:ungrouped`  | 同 `ungrouped`;仅当拖拽键中至少一项已分组时显示 |

- `NewGroupDropZone` 改为拖拽期间 **sticky 固定在列表面板底部**(不再是滚动内容末尾)——解决长列表拖不到的问题。
- 落点高亮沿用现有 ring 样式(`isOver` 驱动)。
- **自落 no-op**:拖拽键已全部属于目标分组(含拖分组头落回自身)→ 忽略,不触发 mutation 与落点反馈。

### B3.5 右侧拖放板(drop board,双落面)

任意列表拖拽开始 → 右侧面板**临时替换**为拖放板;拖拽结束(落下或 Esc 取消)恢复原内容(详情 / 批量面板 / 空态)。与列表内原地落点**同时生效**——近处精确落列表,远处大目标落板。

- 板结构:标题 `移动 N 项到…` + 卡片网格(`auto-fill minmax(160px,1fr)`,多组时板内滚动):每个自定义分组一张卡(文件夹图标 + 名称 + 成员数)+ 「＋新建分组」虚线卡 + 条件性「未分组」卡(见 B3 表)。
- source 分组不上板(不可指派,与列表一致)。
- 卡片 isOver 高亮与落点反馈(B4-4 闪烁)同列表规则;板上无折叠,spring-loading 不适用。
- 附带收益(写进 PR 描述):长列表无需 auto-scroll 即可达任意分组;**搜索过滤时目标分组不在列表里也能经板落**。
- skills / mcp 两页对称实现。

### B4 五件套体验(动效参数一律引 §10.2 token)

1. **拖影+徽章**:`DragOverlay` 渲染行样式缩略(图标+名称);出现时 **lift**——scale 1→1.02 + shadow(`--dur-fast`);`keys.length > 1` 时右上角数量徽章 pop-in(scale 0.6→1,`--dur-fast`)。
2. **spring-loading**:`onDragOver` 落在**折叠**分组上启动 600ms 计时,期满自动展开(复用 A4 折叠动画);拖离取消计时;展开后不自动回折。
3. **auto-scroll**:dnd-kit core 内置,确认对 `overflow-y-auto` 容器生效即可。
4. **落点反馈**:drop 成功后目标 section 头/板卡闪烁一次(accent 底色 400ms 渐隐);**dropAnimation**(dnd-kit 内置):落下成功 overlay 飞向落点消散,取消/Esc 飞回原位(~250ms)。不加 toast。
5. **Esc 取消**:拖拽中按 Esc 取消(dnd-kit 内置,e2e 断言)。
6. **isOver 高亮**:ring/tint 以 `--dur-fast` 过渡,板卡叠加 scale 1.02。
7. **拖放板入场**:卡片 fade + translateY(4px),30ms stagger,总时长 ≤200ms;动画仅 opacity/transform,**不延迟 pointer-events**(板出现即可落)。
8. **VT-1 位置连续动画**:分组指派/移出/删除的状态更新用 `document.startViewTransition` 包裹(feature-detect,不支持则直接执行更新,零分支差异),列表项按 key 设 `view-transition-name`——项从原 section **滑动**到目标 section。与 dropAnimation 互补:overlay 飞向落点,列表内的项滑进新位置。`prefers-reduced-motion` 下 VT 自动禁用;e2e 在 reduce 下不受影响(§10.3)。

### B5 e2e 改造(质变点)

- 删除合成 `DragEvent` helper(`dragOptionTo`),改 Playwright 真实鼠标:`mouse.move(源中心) → down → 分步 move(越过 8px)→ move(目标中心) → up`。
- 用例:
    - `dragging a skill onto a group assigns it`(真实驱动重写)
    - `dragging onto the new-group zone creates a group`(重写,断言 zone 出现在面板底部)
    - `dragging a selected item carries the whole selection`(选 2 拖 1,overlay 徽章=2,落组后两项都归组)——此前合成事件测不了,现在能
    - `hovering a collapsed group while dragging expands it`(spring-loading)
    - `pressing escape cancels the drag`
    - `the drop board replaces the detail panel while dragging`(板出现,拖完恢复原内容)
    - `dropping on a board group card assigns the dragged items`
    - `dropping on the board new-group card opens the naming dialog`
    - `the board ungrouped card removes dragged items from their group`(且未分组项拖拽时该卡不出现)
- **有牙验证**:把 spring-loading 计时器改为永不触发 → 对应用例应红;把 `dragSelectionPayload` 改为只回拖拽项 → multi-drag 用例应红。

### B6 真机清单(合入门槛,逐条勾选)

1. 单项拖入分组/拖出到未分组/拖到新建 zone,三条链路成功。
2. 快速点击、双击、⌘点击、⇧点击均不误触拖拽;拖拽结束后选择状态无意外变化。
3. 多选后拖其中一项,拖影徽章显示数量,落组后全组归位。
4. 折叠分组悬停 ~0.6s 自动展开;拖离不展开。
5. 长列表(>1 屏)拖到边缘自动滚动;新建 zone 固定可见。
6. Esc 取消拖拽,无残留高亮。
7. 窗口失焦/切页中断拖拽无残留状态。
8. 拖拽开始右侧变拖放板、落卡成功;落下/取消后恢复原内容(详情、批量面板、空态三种起点各验一次)。
9. 搜索过滤掉目标分组时,经板落组成功;多选拖拽落板,全组归位。
10. VT-1:落组后项**滑入**目标 section(WKWebView 支持确认);临时禁用 feature-detect 走降级路径,行为正确只是无动画。

---

## 4. PR-C 面板骨架(batch inspector 一期)

重构 `bulk-actions-panel.tsx` 为三段 flex(布局已过目定稿):

- **头(固定)**:`已选 N 项` + 反选按钮(新增:`onInvertSelection`,页面实现=orderedKeys 差集)+ 清除 ×。`sourceContext`(整库选中)保留现有头部形态。
    - 实现注记:`orderedKeys` 目前在列表组件内部计算,反选需要列表把它暴露给页面(回调 prop 或把计算上提),实现时二选一,勿在页面重复推导排序。
- **身(滚动)**:
    - roster 列表行:资源图标 + 名称 + 徽章(skill:source 名或分组名;mcp:transport 类型)+ 行尾 ×(**从选择移出**,非删除)。新 prop `onRemoveItem(key)`,页面实现=selection 差集;移出至 1 项时依既有语义自动切回详情面板(已有 e2e 保障)。
    - 统计行:`来自 N 个 source · M 个已收藏`(skill);mcp 版:`N 种 transport · M 个已收藏`。
    - 矩阵占位:「管理 Agents」按钮(开现有 `ManageAgentsDialog`),PR-D 替换。
- **尾(固定)**:动作分区 `Agents`(复制到…)/ `整理`(收藏、移到分组、移出分组)/ `危险区`(删除 N 项,按钮文案带数量)。「添加到 Agent」在一期仍留在 Agents 区,PR-D 被矩阵吸收后移除。
- 图标一律走 `ACTION_ICONS`(PR-A)。

数据接线:roster 徽章需要 source/分组信息——skills 页已有 `globalLock` + `assignments`,通过 items 传入(扩展 `BulkPanelItem` 增加 `badge?: string`),面板保持展示组件不自取数据。

动效与布局:

- 右侧面板**三态切换**(详情 ↔ 批量 ↔ 空态,含拖放板恢复)统一为 150ms cross-fade + 4px 位移——封装一个过渡容器组件,两页共用,禁止逐处手写;快速连续切换不闪烁(真机清单)。
- roster 单项移出:行 fade + 高度收起(`--dur-fast`)。
- 「未分组」标签行与分组头的视觉层级对齐(字号/间距/留白,仍不可交互)——修掉当前的视觉孤儿感。
- **L-2 分组头吸顶**:滚动时当前分组头 `position: sticky` 吸顶(top 0,背景取面板底色防透字);真机验证与头部选中态、拖拽 isOver 高亮、header 拖拽三者兼容。

e2e:

- `bulk panel lists each selected item with a remove control`(移出一项 count 减一)
- `removing down to one item returns to the detail panel`(复用既有语义断言)
- `invert selection flips the selected set`
- 既有 bulk 面板用例的按钮断言按新分区更新。

---

## 5. PR-D 面板矩阵(batch inspector 二期)

### D1 数据与状态

- 行 = `useAgentAvailability` 中 usable 且 `supportsSkill/supportsMcp` 的 agent。
- 列值 = 选中项在该 agent 的安装数:`installed/total`,三态:**全装**(accent 实底)/ **部分**(描边 + n/total)/ **无**(muted)。
- 数据源:选中项的 `items[].agent` 聚合,无新端点。

### D2 交互状态机

| 当前态    | 点击行为           | 确认                                             |
| --------- | ------------------ | ------------------------------------------------ |
| 无 / 部分 | 补齐安装(只装缺的) | 不确认,行内 spinner                              |
| 全装      | 全部卸载           | **需确认**(AlertDialog,卸载=从 agent 删除该资源) |

- 批量编排:per-(item×agent) mutation 并发,行内 spinner;部分失败 → toast 汇总(`成功 x / 失败 y`)+ 矩阵按真实结果刷新(invalidate 后重算),不做回滚。
- 「添加到 Agent」按钮从尾部移除(被矩阵吸收);「复制到…」(transfer)保留为按钮——它带目标选择语义,不并入矩阵。

### D3 验证

- mocks 扩展:skills/mcps 的 add-to-agent / delete 端点做成**有状态**(参照 mcp PUT mock 先例),矩阵操作后 list 重取反映变化。
- e2e:
    - `matrix shows full/partial/none states for the selection`
    - `clicking a partial row installs the missing items`(状态变全装)
    - `clicking a full row asks for confirmation before uninstalling`
- **有牙验证**:把「只装缺的」改成「全部重装」→ 状态断言应仍绿(结果等价),改为「装到错误 agent」→ 应红;确认框移除 → 确认用例应红。

---

## 6. PR-E 键盘 + 右键补全

### E1 键盘标准集(3b)

实现位置:`useListSelection` 扩展(window 级监听,以列表容器 ref 的 focus-within / hover-within 为作用域门),豁免检查:`event.target` 是 `input/textarea/[contenteditable]` 或任一 overlay 打开时(dialog/menu/popover 存在)一律不响应。

| 键                 | 行为                                 | 备注                                                                       |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------- |
| ⌘A / Ctrl+A        | 全选 `orderedKeys`                   | 现状被显式丢弃(hook 第 72 行),改为接管;多 ListBox 原生 select-all 继续忽略 |
| Esc                | 清除选择 → 空态                      | 与「再点取消」同语义                                                       |
| 点击列表空白       | 清除选择                             | 容器 onClick,target 校验为容器自身                                         |
| Delete / Backspace | `requestDelete()`(打开既有确认框)    | 选择非空时                                                                 |
| F2                 | 焦点在自定义分组头时 → 重命名 dialog | 分组头已是 button 可聚焦                                                   |

Enter 不新增行为(详情随单选自动显示;分组头 Enter=全选已有)。跨段方向键桥不做(v3 候选,记入 interaction-model.md 的「已知边界」)。

### E2 右键补全

- **空白区菜单**(列表容器 onContextMenu,target 校验):skills=新建 skill / 导入 skill / 新建分组 / 刷新;mcps=手动创建 / 导入 / 新建分组 / 刷新。动作复用页面既有 handlers,通过 props 传入列表或在页面层挂容器(倾向页面层,动作本就在页面)。
- **自定义分组头菜单**扩展为:全选成员 / 添加到 Agent(先选中成员再 `requestAddToAgent`)/ 收藏全部 / 重命名 / 删除分组(危险区)。
- **source 分组头菜单**:现有(选中成员+items 菜单)基础上,顶部加「在浏览器打开」(有 sourceUrl 时)。
- **kbd 提示列**:菜单项右侧用 HeroUI `Kbd`:删除 ⌫、全选 ⌘A(空白区菜单)。**只标真实实现的快捷键**。

### E2.5 菜单与空态动效

- 菜单入场:scale 0.96→1 + fade(`--dur-fast`),`transform-origin` 取指针所在角;若 HeroUI standalone `PopoverContent` 自带 entering/exiting 动画则沿用并 token 化时长(实现时确认)。
- **点选项闪烁确认**:点击菜单项后该项 opacity 快闪一次(~120ms)再关闭菜单——macOS 原生菜单惯例,状态确认感最强的一笔,成本一个 CSS animation。与 A1 的「点选即关」串联:闪烁完成 → close。
- 空态教学面:「请选择」占位升级为 图标 + 主文案 + 快捷键提示行(`⌘A 全选 · 右键空白处新建`)——键盘与空白菜单在本 PR 落地,提示才真实。

### E3 e2e

- 每个键一个用例(含豁免:焦点在搜索框时按 Delete 不触发删除确认)。
- `right-clicking empty list space offers create/import/new-group/refresh`
- `custom group header menu operates on its members`(收藏全部 → 成员星标)
- **有牙验证**:注释 Delete 监听 → 用例红;移除输入框豁免 → 豁免用例红。

---

## 7. PR-F 契约固化(本地成稿,审过前不建仓/不提交)

### F1 `crates/desktop/docs/interaction-model.md`(aghub 契约)

目录:①模型(名词-动词、单一 selection、投影原则)②四入口×三单元矩阵表(click/右键/拖拽/面板 × 单项/多选/分组)③选择语义(点击/⌘/⇧/再点取消/加载播种)④菜单契约(每个菜单的条目全集表 + `ACTION_ICONS` 映射 + 点选即关规则 + disable-vs-hide 规则)⑤拖拽契约(源/落点表含**双落面**(列表原地 + 右侧拖放板)+ 参数:阈值 8px、spring 600ms、徽章规则、Esc)⑥键盘表(E1 全表 + 豁免规则)⑦面板契约(三段结构 + 矩阵状态机)⑧e2e 映射表(每条交互 → spec 文件#用例名)⑨已知边界(跨段方向键、source 组不可落)。

### F2 通用 skill(新 GitHub 仓库,名称候选 `desktop-list-interactions`)

SKILL.md 结构:何时用(触发词:列表交互/多选/右键/拖拽/批量)→ 哲学(noun-verb、单一选择真相源、投影原则)→ 设计决策清单(新增列表交互前要回答的问题清单:入口×单元矩阵是否闭合、空态/单选/多选三态、键盘契约、拖拽五件套、菜单结构规则)→ 标准指路(Apple HIG Contextual Menus & Drag and Drop、WAI-ARIA APG Listbox/Grid、Material 3 selection、Atlassian DnD guidelines)→ 验收清单模板(可直接抄进 PR)。项目无关,不含 aghub 细节;结尾注明「项目内若存在 interaction-model.md 以其为准」。

交付流程:两份文档本地写好 → 用户审 → 审过后才:建 GitHub 仓库放 skill、aghub 文档随 PR 提交。

---

## 8. 横切验证策略(每 PR 合入门槛)

1. `tsc` / `lint`(0 error)/ `build` / 全量 e2e 绿。
2. 本 PR 新增的每个关键 e2e 做一次**有牙验证**(按各期给出的植入点,植入 → 红 → 还原 → 绿),结论写进 PR 描述。
3. 真机清单逐条勾选贴 PR(PR-B 的 §B6 为硬门槛;其余 PR 至少含:目标交互 + 相邻页面回归 skills/mcp 双页)。
4. i18n:新文案三语齐(en / zh-Hans / zh-Hant),占位符风格与既有一致(字段名即占位,无示例词)。
5. mock 扩展遵循「有状态 PUT」先例,不引第二种 mock 风格。

## 9. 风险与缓解

| 风险                                              | 缓解                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| dnd-kit 与 react-aria 手势冲突(点击误拖/拖后误选) | 8px 阈值 + 拖拽期忽略选择变更 + B6-2 真机硬门槛                                            |
| 拦截假设不成立                                    | PR-A gate:验证失败即停,重估 PR-B                                                           |
| dnd-kit 维护节奏放缓                              | 锁版本;我们只用 core 的窄面(draggable/droppable/overlay/autoscroll),必要时可自研替换同接口 |
| 矩阵批量部分失败                                  | 不做回滚,按真实结果刷新 + toast 汇总;确认框拦住全卸                                        |
| 全局键盘监听误伤                                  | 可编辑元素 + overlay 双豁免,豁免各有 e2e                                                   |
| 面板改版破坏既有 e2e                              | 分区断言集中更新在 PR-C,一次理清                                                           |
| 拖放板与批量面板状态切换残留                      | 板的显隐只由 DndContext 拖拽态驱动,不落地任何持久状态;B6-8 三种起点各验                    |

## 10. 动效与布局规范(横切)

### 10.1 原则

- 动效只服务两件事:**空间连续性**(东西从哪来、到哪去)与**状态确认**(操作生效了)。装饰性动画不做。
- 只动 `opacity` / `transform`(展开类另用 grid-rows 0fr↔1fr 技巧);不动布局属性;无阻塞动画,全部可被下一次交互打断。
- 单段动画时长上限 300ms;高频反馈(hover / isOver / 选中)一律 fast 档。
- 参照:Apple HIG Motion、Material 3 motion tokens。

### 10.2 token(theme.css,PR-A 落地)

```
--dur-fast: 120ms;  /* hover、高亮、选中、菜单 */
--dur-base: 200ms;  /* 展开折叠、面板切换 */
--dur-slow: 280ms;  /* 拖放板入场、dropAnimation 级 */
--ease-out: cubic-bezier(0.2, 0, 0, 1);
```

新代码动效一律引 token,禁止新增裸数值(存量 42 处零散 transition 不回改,新增起执行)。

### 10.3 reduced-motion 与 e2e 策略

- 全局 `@media (prefers-reduced-motion: reduce)`:transition/animation 时长归零。
- Playwright 配置强制 `reducedMotion: "reduce"`:**动画永不参与 e2e 断言**,动效与测试确定性从根上解耦;动效本身只由真机清单验收。

### 10.4 归属速查

| 动效                                                                       | PR  |
| -------------------------------------------------------------------------- | --- |
| 折叠展开(grid-rows)、chevron 旋转、选中态过渡、token/reduce 地基           | A   |
| lift、dropAnimation、徽章 pop、isOver 过渡、板入场 stagger、spring-loading | B   |
| 面板三态 cross-fade、roster 移出收起、未分组标签对齐                       | C   |
| 菜单入场、点选项闪烁确认、空态教学面                                       | E   |

### 10.5 可选增强(已勾选定案)

- **VT-1 已采纳** → 并入 PR-B(§B4-8、§B6-10)。
- **L-2 已采纳后回退**:吸顶底色与 UA 画布无匹配 token,呈现为全宽色带(违反组头=list-item 规则);重做前提=列表容器统一显式底色,列入 v3。
- L-1 列表宽度可调 → 未采纳,移入 §11 非目标。

## 11. 非目标(v3 候选,本轮明确不做)

- 拖到 sidebar 的 agent / 项目(= add-to-agent 的拖拽投影)——拖放板已满足「大落点」诉求,跨面板语义留观察
- 分组手动排序(拖组头重排)
- 跨段方向键焦点桥(键盘拖拽 sensor 同)
- 框选(marquee selection)——320px 窄列表价值低
- 列表面板宽度可拖拽调节(L-1,divider + store 持久化)——本轮未采纳
