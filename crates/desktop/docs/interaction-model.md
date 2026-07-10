# 资源列表交互契约(aghub desktop)

本文档是 skills / mcp-servers / 项目详情统一列表三个面的交互事实来源。改交互前先读这里;新动作先进动作层再各自投影。状态:与实现同步(v2 spec 全量落地)。

## 1. 模型

- **名词-动词**:先选中一个单元(名词),再施加动作(动词)。不做"动词模式"。
- **单一 selection**:`selectedKeys: Set<string>` 是唯一选择真相源,直接喂给 react-aria。加载时播种首项(或 URL 深链),空选中 = 明确的"已取消" → 空态占位。详见 `use-list-selection.ts` 与页面 `handleSelectionChange`。
- **投影原则**:菜单、面板、拖拽、键盘是同一动作层(`use-resource-actions`)的四个投影。任何入口不得私有一个动作实现。

## 2. 四入口 × 三单元矩阵

|          | 单项                                                    | 多选                                      | 分组                                                 |
| -------- | ------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| **左键** | 选中→详情;再点取消                                      | ⌘/⇧ 加/范围;再点收敛                      | 自定义组头点击=选全组(再点取消);源簇行点击=展开/收起 |
| **右键** | Finder 语义:命中已选→作用于整个多选;命中未选→重置为该项 | 作用于整个选择                            | 自定义组:重命名/删除组;source 组:选中成员+items 菜单 |
| **拖拽** | 拖入组/未分组/新建区/拖放板                             | 携带整个选择(payload 在 pointerdown 冻结) | 拖组头=拖全组成员                                    |
| **面板** | (单选走详情面板)                                        | batch inspector:roster 单项移出、动作分区 | 整库选中时面板顶部带 source header                   |

## 3. 选择语义

- 左键单击未选项 → 选中它(详情显示)。
- 左键单击**唯一已选项** → 取消(空态)。加载时被播种高亮的首项不算"已提交",点它是选中而非取消。
- ⌘/Ctrl 单击 → 切换该项进/出选择。
- ⇧ 单击 → 跨 section 范围选,锚点=上次点击(无点击历史时退化为当前唯一选中项,含播种首项)。范围只覆盖**可见行**——收起的分组/源簇成员不被圈入(`orderedKeys` 即可见序)。
- 退出多选模式 → 塌缩回单个选中(详情保留),非清空。
- **自定义**组头左键 → 选全组成员;组正是唯一选择时再点 → 取消。
- **源簇**行左键 → 仅展开/收起(浏览容器,不选中);⌘左键 → 全簇成员进/出选择;右键 → 选中全簇 + items 菜单。拖拽期间源簇整行降透明度(不可落)。

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

| 落点       | id                                | 行为                                          |
| ---------- | --------------------------------- | --------------------------------------------- |
| 自定义分组 | `group:{id}` / `board:group:{id}` | assignMembers                                 |
| 未分组区   | `ungrouped` / `board:ungrouped`   | unassignMembers(拖拽键含已分组项时板卡才显示) |
| 新建分组   | `new-group` / `board:new-group`   | 打开命名 dialog                               |
| source 组  | 不注册                            | 不可落                                        |

- **payload 冻结**:列表项 draggable 在 pointerdown(冒泡到 react-aria 前)把 payload 冻结进 ref,防止按下已选项时 react-aria 收敛选择而丢掉多选。组头传普通数组(成员固定不收敛)。
- **自落 no-op**:拖拽键已全属目标分组 → 忽略,不 mutation。
- 每个面各自一个页面级 `DndContext`(`use-list-dnd.ts`),skill/mcp 分开防落点 id 冲突;统一列表持一 skill + 一 mcp context。
- **参数**:数量徽章(>1 项)、DragOverlay 预览、isOver ring 高亮、板入场 stagger、Esc 取消。
- **spring-loading**:拖拽悬停**折叠的自定义组** 600ms 自动展开(source 组不可落,不弹开)。
- **落点反馈**:drop 成功后目标闪烁一次——命令式 `el.animate`(`flashDropTarget`),不走 state;延迟 setState 会在下一次按下与越过阈值之间重渲染,吞掉激活。sensor options/measuring 为模块级常量,同一原因。
- **VT-1**:分组指派/移出/删除包 `withViewTransition`,列表项带 `view-transition-name` → 项滑动到新 section;不支持或 reduce 时静默直跑。

## 6. 键盘契约

作用域门:**整页**(设置页单列表,详情/批量面板上也生效)hover 或 focus-within;豁免:焦点在 input/textarea/[contenteditable],或任一 dialog/menu 打开时。监听在 **capture 阶段**并对命中键 stopPropagation——react-aria ListBox 自己也处理 Esc(且会拦传播),不接管的话焦点在列表内时清选会被劫持。实现见 `use-list-keyboard.ts`。

| 键                   | 行为                     |
| -------------------- | ------------------------ |
| ⌘A / Ctrl+A          | 全选                     |
| Esc                  | 清除选择 → 空态          |
| Delete / Backspace   | 打开删除确认(选择非空时) |
| F2(焦点在自定义组头) | 重命名分组               |
| 点击列表空白         | 清除选择                 |

拖拽进行中键盘快捷键整体停用(Esc 只取消拖拽,不清选择)。

## 7. 面板契约(batch inspector)

三段全高:

- **头(固定)**:已选 N 项 + 清除;整库选中时顶部带 source header(可开浏览器)。
- **身(滚动)**:roster = 可删除 **TagGroup**,按来源**分节**(节头=来源名+计数,uppercase 小字;无来源的归「未分组」垫底;单节时不显示节头)。每个 tag 自带 × 从选择移出(非删除);移出至 1 项自动回详情。**Agent 覆盖矩阵**:两列格子,每格 agent 图标 + 名称 + n/N;全装=accent 填充+ring,无=名称 muted;用法提示收在标题旁 ? tooltip。点击 无/部分 → 只补装缺失(不确认,格内 spinner);点击 全装 → AlertDialog 确认后全卸。部分失败 toast 汇总,不回滚,按刷新结果重算。走 `skills|mcps/reconcile`。
- **尾(固定)**:两列网格 —— transfer / 收藏 / 移到分组 / [移出分组],**「删除 N 项」danger 按钮占右下角格**。

## 8. e2e 映射

真实测试在 `e2e/list-interactions.spec.ts`(skills)与 `e2e/mcp-selection.spec.ts`(mcp)。拖拽用 Playwright **真实鼠标**驱动(dnd-kit 是 pointer 系);helper 会先等刚关闭 dialog 的 backdrop 清空。reduced-motion 强制开启,动画永不参与断言。

## 9. 已知边界

- **区段顺序**:自定义分组(一等,粗体卡片)在最上;其下是一个**统一的 loose 列表**——来源(source)聚合与散落的未分组项**同一层级**混排,每个条目按 收藏优先 → 名字(来源按末段名)排序。来源不是独立区段,而是一行「带折叠箭头的普通 skill 行」:同字重/大小/间距,chevron 占普通行的图标位。**默认收起**;含当前选中项(seed/深链)的簇初始展开,搜索时全部强制展开。行点击=展开/收起;头部可整体拖拽(把全簇成员拖入自定义组)。簇内任一 skill 被收藏,整簇浮到 loose 列表顶部。
- 跨 section 方向键焦点桥:不做(v3 候选)。
- source 簇不可作为落点(它不是用户分组),**拖拽期间整行降透明度**标示非目标;拖到 loose 区域 = 移出到未分组。
- 拖到 sidebar 的 agent / 项目:不做(拖放板已满足大落点诉求)。
- 分组手动排序、框选:不做。

## 10. 实现补记

- 面板三态切换经 `PanelTransition`(state key 驱动的入场 fade/slide,不做退场)。组头吸顶(L-2)**已回退**:stuck 头需要不透明底色,而没有 token 能匹配 UA 画布,结果就是被设计规则禁止的全宽色带;要重做须先给列表容器统一显式底色(v3 候选)。
- 空态教学面:占位下附「⌘A 全选 · 空白处右键」提示。
- e2e 时序注意:合成指针在上一次点击 ~50ms 内再按下可能丢失 sensor 激活,真实指针不可复现;相关用例以人手节奏(~300ms)间隔。
