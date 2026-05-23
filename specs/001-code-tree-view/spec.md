# Feature Specification: Tree-Based Code View

**Feature Branch**: `001-code-tree-view`  
**Created**: 2026-05-23  
**Status**: Draft  
**Input**: User description: "在目前力导向球视图的基础上，添加一个一个树形视图，以便更容易地理解代码的结构和复杂度。在树形视图中，只有物理结构（文件夹、文件、类、函数）等会以树节点的形式展示，形式一个有多个根的树图。节点可以按字母或是出入度数量来做排序。非物理结构（如调用、引用、参数声明等）会以虚线的形式在各个树节点之间形成链接。注意现有的过滤功能也要保持兼容。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read Repository Structure Faster (Priority: P1)

作为正在理解陌生代码库的开发者，我希望把当前的代码图切换为树形视图，这样我能先看到文件夹、文件、类、函数之间的物理归属关系，再去理解更复杂的依赖关系。

**Why this priority**: 当前力导向图更适合观察关系网络，但在理解“代码放在哪里、归属于谁”时认知成本较高。先补足结构视图，能立即提升首次阅读代码库时的可理解性。

**Independent Test**: 加载一个已有代码图后，用户可以切换到树形视图，并在不依赖力导向布局的前提下，从一个或多个根节点逐层展开到目标文件或符号。

**Acceptance Scenarios**:

1. **Given** 用户已经加载一个代码库图谱，**When** 用户切换到树形视图，**Then** 系统展示一个由物理结构节点组成的多根树，而不是继续显示力导向布局。
2. **Given** 某个类、函数或方法存在明确的物理父级，**When** 树形视图渲染该节点，**Then** 该节点出现在其物理父级之下，而不是以独立根节点出现。
3. **Given** 某个物理节点没有可见的物理父级，**When** 树形视图渲染它，**Then** 该节点作为根节点之一显示。

---

### User Story 2 - Inspect Complexity and Dependencies in Context (Priority: P2)

作为正在评估结构复杂度的开发者，我希望在树中按字母或出入度排序，并同时看到跨层级的虚线关系，这样我可以在保持物理上下文的同时识别复杂或高耦合的部分。

**Why this priority**: 仅有树结构可以回答“在哪里”，但不足以回答“哪里复杂”。排序和虚线关系让用户能在结构上下文中快速发现热点。

**Independent Test**: 用户无需切回力导向视图，就能在树形视图中切换排序模式，并观察非物理关系如何跨树分支连接可见节点。

**Acceptance Scenarios**:

1. **Given** 树形视图已经显示一组同级节点，**When** 用户切换为字母排序，**Then** 同级节点按名称稳定排序。
2. **Given** 树形视图已经显示一组同级节点，**When** 用户切换为入度或出度排序，**Then** 同级节点按当前可见关系数量排序，并保留可区分的并列处理规则。
3. **Given** 两个节点之间存在非物理关系且两端节点均可见，**When** 树形视图渲染关系，**Then** 系统以虚线连接它们，而不是把该关系转换成树节点。

---

### User Story 3 - Keep Existing Exploration Controls Consistent (Priority: P3)

作为已经依赖现有过滤与选中交互的用户，我希望树形视图和力导向视图共享同一套过滤状态与当前选中上下文，这样我在切换视图时不会丢失探索进度。

**Why this priority**: 如果新视图与现有过滤器不兼容，用户必须为同一批数据重复设置条件，体验会割裂，也会降低对两个视图结果一致性的信任。

**Independent Test**: 用户在任一视图中设置节点过滤、关系过滤、焦点深度并选中节点后，切换到另一视图仍能看到等价的数据范围和当前上下文。

**Acceptance Scenarios**:

1. **Given** 用户已经应用节点类型过滤和关系类型过滤，**When** 用户在力导向视图与树形视图之间切换，**Then** 两个视图都只显示符合当前过滤条件的节点和关系。
2. **Given** 用户已选中一个仍然可见的节点，**When** 用户切换视图，**Then** 该节点保持选中并继续提供一致的详情与导航行为。
3. **Given** 当前焦点深度过滤会隐藏某些节点，**When** 用户切换到树形视图，**Then** 树与虚线关系只显示该焦点范围内的可见节点。

### Edge Cases

- 当一个物理节点缺少可识别父级、或其父级因过滤条件被隐藏时，该节点如何正确提升为根节点。
- 当同级节点在度数排序上出现并列时，系统如何使用稳定的次级规则避免顺序抖动。
- 当两个可见节点之间存在多种非物理关系时，系统如何避免把多条关系误读为多份结构节点。
- 当过滤条件导致某个分支没有任何可见子节点或没有任何可见虚线关系时，系统如何清楚表达“被过滤隐藏”而非“数据不存在”。
- 当同名类或函数位于不同文件或不同父级下时，系统如何保证用户仍能从树位置判断其归属。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a view switch that lets users move between the existing force-directed view and a tree-based view within the same repository exploration workflow.
- **FR-002**: System MUST render only physical structure nodes as tree nodes in the tree-based view, including containers and declared code elements that belong to the source structure.
- **FR-003**: System MUST exclude non-physical constructs from the tree hierarchy itself, including relationship-only concepts and metadata-only concepts.
- **FR-004**: System MUST organize visible physical nodes into one or more tree roots whenever the visible dataset does not collapse to a single root.
- **FR-005**: System MUST place each visible physical node under its nearest visible physical parent when such a parent exists in the current filtered dataset.
- **FR-006**: System MUST render non-physical relationships between visible tree nodes as cross-links with a dashed visual style that is distinct from structural parent-child links.
- **FR-007**: System MUST allow users to sort sibling tree nodes alphabetically, by inbound relationship count, and by outbound relationship count.
- **FR-008**: System MUST apply sibling sorting consistently across all expanded branches in the current tree view.
- **FR-009**: System MUST calculate inbound and outbound relationship counts from the relationships that remain visible under the current filter state.
- **FR-010**: System MUST keep existing node-type filters compatible with the tree-based view so that the same filter choices affect both views.
- **FR-011**: System MUST keep existing relationship-type filters compatible with the tree-based view so that the same visible relationship set controls both force-directed edges and tree-view cross-links.
- **FR-012**: System MUST keep the existing focus-depth behavior compatible with the tree-based view so that users can limit the visible neighborhood around a selected node in either view.
- **FR-013**: System MUST preserve the current selected node, active filters, and current focus context when users switch between the two view modes, unless the selected node is no longer eligible to display.
- **FR-014**: System MUST provide the same node-level inspection outcome in tree view as in the existing graph exploration flow, including access to node details and source-oriented navigation.
- **FR-015**: System MUST show a clear empty or filtered state whenever a branch, selection, or entire tree view has no eligible visible nodes after filters are applied.
- **FR-016**: System MUST ensure that the same physical node appears only once in the visible tree hierarchy at any point in time.

### Key Entities *(include if feature involves data)*

- **View Mode**: The user-selectable exploration mode for the same repository graph, such as force-directed view or tree-based view.
- **Physical Tree Node**: A visible structure item in the tree, such as a folder, file, class, interface, function, method, or another declared code element that belongs to a physical parent.
- **Tree Root**: A top-level physical node shown without a visible physical parent in the current dataset.
- **Cross-Link**: A non-structural visible relationship drawn between two tree nodes to show dependency, usage, call, reference, or other non-physical connections.
- **Sort Mode**: The active ordering rule applied to sibling tree nodes, such as alphabetical order, inbound degree, or outbound degree.
- **Filter State**: The current combination of node visibility rules, relationship visibility rules, and focus-depth rules shared across visualization modes.

### Assumptions

- “代码复杂度”在本功能中通过结构位置、跨分支虚线关系以及入度/出度排序来辅助判断，而不是引入新的独立复杂度评分模型。
- 现有过滤能力已经被用户接受为探索代码图的基础控制方式，因此树形视图复用同一套过滤状态而不是定义一套新规则。
- 只有具备单一物理归属的节点会进入树层级；社区、流程等面向分析的概念继续作为非树结构处理。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在已能成功加载现有代码图的仓库中，用户切换到树形视图后，95% 以上的可见物理节点都能在一个或多个根节点下被展示，且不会丢失其可见父子归属。
- **SC-002**: 用户在树形视图中切换任一排序模式后，新的同级排序结果可在 2 秒内稳定呈现，且当前选中节点不会因排序而丢失。
- **SC-003**: 对同一仓库应用相同的节点过滤、关系过滤和焦点深度条件时，两种视图在 100% 的验证样例中展示相同的合格节点集合与合格关系集合。
- **SC-004**: 在代表性仓库的可用性检查中，90% 的参与者能够在 30 秒内通过树形视图定位目标符号所属的文件与上级结构。
- **SC-005**: 在代表性仓库的可用性检查中，90% 的参与者能够仅通过树形视图的排序与虚线关系识别出至少一个高连接度的结构热点。
