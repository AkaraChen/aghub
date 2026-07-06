# 资源列表交互契约(aghub desktop)

本文档是 skills / mcp-servers / 项目详情统一列表三个面的交互事实来源。改交互前先读这里;新动作先进动作层再各自投影。状态:与实现同步(v2 spec 全量落地)。

## 1. 模型

- **名词-动词**:先选中一个单元(名词),再施加动作(动词)。不做"动词模式"。
- **单一 selection**:`selectedKeys: Set<string>` 是唯一选择真相源,直接喂给 react-aria。加载时播种首项(或 URL 深链),空选中 = 明确的"已取消" → 空态占位。详见 `use-list-selection.ts` 与页面 `handleSelectionChange`。
- **投影原则**:菜单、面板、拖拽、键盘是同一动作层(`use-resource-actions`)的四个投影。任何入口不得私有一个动作实现。

## 2. 四入口 × 三单元矩阵

| | 单项 | 多选 | 分组 |
| --- | --- | --- | --- |
| **左键** | 选中→详情;再点取消 | ⌘/⇧ 加/范围;再点收敛 | 组头点击=选全组;再点取消;chevron 单独展开 |
| **右键** | Finder 语义:命中已选→作用于整个多选;命中未选→重置为该项 | 作用于整个选择 | 自定义组:重命名/删除组;source 组:选中成员+items 菜单 |
| **拖拽** | 拖入组/未分组/新建区/拖放板 | 携带整个选择(payload 在 pointerdown 冻结) | 拖组头=拖全组成员 |
| **面板** | (单选走详情面板) | batch inspector:roster 单项移出、动作分区 | 整库选中时面板顶部带 source header |

## 3. 选择语义

- 左键单击未选项 → 选中它(详情显示)。
- 左键单击**唯一已选项** → 取消(空态)。加载时被播种高亮的首项不算"已提交",点它是选中而非取消。
- ⌘/Ctrl 单击 → 切换该项进/出选择。
- ⇧ 单击 → 跨 section 范围选(基于 `orderedKeys`)。
- 退出多选模式 → 塌缩回单个选中(详情保留),非清空。
- 组头左键 → 选全组成员;组正是唯一选择时再点 → 取消。

## 4. 菜单契约

条目全集(items 菜单):收藏/取消收藏、添加到 Agent、复制到…(transfer)、[有分组时] 移到分组区(各分组 + 新建分组 + 移出分组)、删除。

- **图标**:一律取自 `ACTION_ICONS`(`action-icons.ts`)单一映射。同动作在菜单/面板同图标。
- **点选即关**:`ContextMenu` 的 Menu 级 `onAction` 统一收口;点中的项先闪烁一次(~120ms,macOS 惯例;reduce 下跳过)再关闭。菜单入场 scale 0.96→1(`menu-in`)。
- **disable-vs-hide**:「移出分组」在有分组但当前选择未分组时 → **disabled 常显**(菜单结构稳定);「移到分组」整区在无分组时隐藏(只留顶层「新建分组」)。
- **kbd 提示列**:只标真实实现的快捷键——items 菜单删除 ⌫;空白区菜单全选 ⌘A;组头菜单重命名 F2。
- **空白区菜单**(列表面板空白处右键):全选(⌘A)/ 新建 / 导入 / 新建分组 / 刷新。空白处左键 = 清除选择。
- **自定义组头菜单**:全选成员 / 添加到 Agent / 收藏全部 / 重命名(F2)/ 删除分组;source 组头菜单顶部有「在浏览器打开」(有 sourceUrl 时)。

## 5. 拖拽契约(dnd-kit,pointer 系)

- 引擎:`@dnd-kit/core` PointerSensor,激活阈值 **8px**,碰撞 `pointerWithin`,`MeasuringStrategy.Always`(拖拽期新建区出现会推移布局,需持续重测)。
- **双落面**:近处精确落列表 section,远处大目标落右侧**拖放板**(拖拽时详情面板临时替换,落下/Esc 恢复)。板卡与列表 section 是同一批目标,板卡 id 加 `board:` 前缀避免同 context 落点 id 冲突。

| 落点 | id | 行为 |
| --- | --- | --- |
| 自定义分组 | `group:{id}` / `board:group:{id}` | assignMembers |
| 未分组区 | `ungrouped` / `board:ungrouped` | unassignMembers(拖拽键含已分组项时板卡才显示) |
| 新建分组 | `new-group` / `board:new-group` | 打开命名 dialog |
| source 组 | 不注册 | 不可落 |

- **payload 冻结**:列表项 draggable 在 pointerdown(冒泡到 react-aria 前)把 payload 冻结进 ref,防止按下已选项时 react-aria 收敛选择而丢掉多选。组头传普通数组(成员固定不收敛)。
- **自落 no-op**:拖拽键已全属目标分组 → 忽略,不 mutation。
- 每个面各自一个页面级 `DndContext`(`use-list-dnd.ts`),skill/mcp 分开防落点 id 冲突;统一列表持一 skill + 一 mcp context。
- **参数**:数量徽章(>1 项)、DragOverlay 预览、isOver ring 高亮、板入场 stagger、Esc 取消。
- **spring-loading**:拖拽悬停**折叠的自定义组** 600ms 自动展开(source 组不可落,不弹开)。
- **落点反馈**:drop 成功后目标闪烁一次——命令式 `el.animate`(`flashDropTarget`),不走 state;延迟 setState 会在下一次按下与越过阈值之间重渲染,吞掉激活。sensor options/measuring 为模块级常量,同一原因。
- **VT-1**:分组指派/移出/删除包 `withViewTransition`,列表项带 `view-transition-name` → 项滑动到新 section;不支持或 reduce 时静默直跑。

## 6. 键盘契约

作用域门:列表面板 hover 或 focus-within;豁免:焦点在 input/textarea/[contenteditable],或任一 dialog/menu 打开时。实现见 `use-list-keyboard.ts`。

| 键 | 行为 |
| --- | --- |
| ⌘A / Ctrl+A | 全选 |
| Esc | 清除选择 → 空态 |
| Delete / Backspace | 打开删除确认(选择非空时) |
| F2(焦点在自定义组头) | 重命名分组 |
| 点击列表空白 | 清除选择 |

拖拽进行中键盘快捷键整体停用(Esc 只取消拖拽,不清选择)。

## 7. 面板契约(batch inspector)

三段全高:
- **头(固定)**:已选 N 项 + 清除;整库选中时顶部带 source header(可开浏览器)。
- **身(滚动)**:roster —— 每项 图标 + 名称 + 徽章(skill: source;mcp: transport 类型)+ 悬停 × 从选择移出(非删除);移出至 1 项自动回详情。统计行(N 个来源)。**Agent 覆盖矩阵**:行=可用且支持该资源的 agent,值=安装数 n/N 三态(全装实底/部分描边/无 muted);点击 无/部分 → 只补装缺失(不确认,行内 spinner);点击 全装 → AlertDialog 确认后全卸。部分失败 toast 汇总,不回滚,按刷新结果重算。走 `skills|mcps/reconcile`。
- **尾(固定)**:transfer / 收藏 / 移到分组 / 移出分组 + 全宽「删除 N 项」。

## 8. e2e 映射

真实测试在 `e2e/list-interactions.spec.ts`(skills)与 `e2e/mcp-selection.spec.ts`(mcp)。拖拽用 Playwright **真实鼠标**驱动(dnd-kit 是 pointer 系);helper 会先等刚关闭 dialog 的 backdrop 清空。reduced-motion 强制开启,动画永不参与断言。

## 9. 已知边界

- **区段顺序**:自定义分组 → 未分组 → 来源(source)聚合。来源是「从哪个仓库装的」出处、不是用户分组,排在最后、不置顶,以免压过用户自己的分组。来源仍保留一等卡片外观(可折叠/select-all/拖拽),仅排序靠后。「未分组」标签仅在其上方有自定义分组时才显示(否则松散项直接领头,无需标签)。
- 跨 section 方向键焦点桥:不做(v3 候选)。
- source 组不可作为落点。
- 拖到 sidebar 的 agent / 项目:不做(拖放板已满足大落点诉求)。
- 分组手动排序、框选:不做。

## 10. 实现补记

- 面板三态切换经 `PanelTransition`(state key 驱动的入场 fade/slide,不做退场)。组头吸顶(L-2)**已回退**:stuck 头需要不透明底色,而没有 token 能匹配 UA 画布,结果就是被设计规则禁止的全宽色带;要重做须先给列表容器统一显式底色(v3 候选)。
- 空态教学面:占位下附「⌘A 全选 · 空白处右键」提示。
- e2e 时序注意:合成指针在上一次点击 ~50ms 内再按下可能丢失 sensor 激活,真实指针不可复现;相关用例以人手节奏(~300ms)间隔。
