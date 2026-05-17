# easyapply 手机端浏览不便样式清单

> 记录时间：2026-05-17  
> 目的：汇总当前前端在手机浏览器下的主要可用性问题，作为后续适配改造清单。

## 1. 最高优先级（直接影响可用性）

### 1.1 全局禁用滚动，溢出后无法自救

- **位置**
  - `src/style/index.css:13` `body { overflow: hidden; }`
  - `src/style/theme.css:169-170` `.app { height: 100dvh; overflow: hidden; }`
- **问题**
  - 页面高度和溢出被锁死，手机上出现遮挡时无法通过自然滚动查看被挡内容。
  - 弹出软键盘时更容易出现输入区域被遮挡。
- **影响**
  - 全局页面和所有侧栏内容浏览体验。

### 1.2 侧边 Panel 固定最小宽度，超出手机可视宽度

- **位置**
  - `src/App.tsx:38` `PANEL_WIDTH_MIN = 360`
  - `src/App.tsx:41` `CONTENT_MIN_WIDTH = 420`
  - `src/App.tsx:43-46` `getPanelMaxWidth`
  - `src/style/theme.css:463-466` `.panel` 最小宽度约束
- **问题**
  - 侧栏和主内容区宽度模型按桌面双栏设计，手机宽度下容易造成主内容被压缩或遮挡。
- **影响**
  - 侧栏打开后主界面可见区域异常。

### 1.3 侧栏与表格拖拽仅支持鼠标事件

- **位置**
  - `src/App.tsx:598-602, 775`（`onMouseDown + mousemove + mouseup`）
  - `src/panels/JobAppliedPanel.tsx:76-80, 243-263`
  - `src/panels/CodeManagementPanel.tsx:77-81, 244-264`
- **问题**
  - 交互模型依赖鼠标，移动端触摸场景下拖拽行为无法正常触发。
- **影响**
  - 侧栏尺寸调整、表格列宽调整在手机端基本不可用。

### 1.4 Cover Letter 页面强制宽屏布局

- **位置**
  - `src/style/theme.css:738` `.clg { min-width: 1280px; }`
  - `src/style/theme.css:765` 三列 `grid-template-columns`
- **问题**
  - 页面最小宽度远大于手机屏幕，三列布局在小屏无响应式降级方案。
- **影响**
  - Cover Letter 页面在手机端几乎不可读且难以操作。

## 2. 中优先级（可读性和操作效率差）

### 2.1 主布局缺少全局移动端断点策略

- **位置**
  - `src/style/theme.css`（主布局无明确 `@media` 适配段）
  - 仅 `src/auth/auth.css:44,185` 有局部窄屏样式
- **问题**
  - 响应式规则零散且仅覆盖部分模块，无法保障整体移动端体验。
- **影响**
  - 各页面在手机端表现不一致，维护成本高。

### 2.2 表格内容在小屏下被强截断

- **位置**
  - `src/style/theme.css:677-685`（`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0`）
  - `src/panels/JobAppliedPanel.tsx:236-261` 固定列宽
  - `src/panels/CodeManagementPanel.tsx:237-262` 固定列宽
- **问题**
  - 小屏中大量信息被省略号截断，难以快速阅读实际字段内容。
- **影响**
  - Job Applied / Code Management 关键信息查看效率低。

### 2.3 表单行布局对窄屏不友好

- **位置**
  - `src/style/theme.css:578-583` `.settings__row { grid-template-columns: 1fr auto; }`
  - `src/style/theme.css:606` `.settings__control { min-width: 180px; }`
- **问题**
  - 非 AuthManager 区域在小屏下仍可能挤压或出现横向空间不足。
- **影响**
  - 设置类面板输入体验下降。

### 2.4 信息栏强制不换行，窄屏易溢出

- **位置**
  - `src/style/theme.css:280-281` `.app__meta { min-width: max-content; white-space: nowrap; }`
  - `src/style/theme.css:1055-1061` `.path__value` 路径截断策略
- **问题**
  - 元信息和长路径在手机端显示空间不足，布局容易紧绷或信息不可见。
- **影响**
  - 顶部信息可读性与可见性受损。

### 2.5 部分交互依赖 hover，不适配触摸端

- **位置**
  - `src/panels/CodeManagementPanel.tsx:308-315`（密码显示依赖 `onMouseEnter/onMouseLeave`）
  - `src/style/theme.css` 中多处 `:hover` 视觉反馈
- **问题**
  - 手机端无稳定 hover 语义，关键交互应提供 click/tap 等替代方式。
- **影响**
  - 部分功能在手机端行为不确定或不可用。

## 3. 后续改造建议（用于拆任务）

1. **先保可用**：放开页面滚动（至少移动端放开）并增加 `<768px` 全局断点。  
2. **侧栏改型**：移动端将右侧 panel 改为全屏抽屉或底部弹层，不再沿用桌面双栏。  
3. **事件统一**：拖拽交互改用 Pointer Events，或在移动端直接禁用拖拽并给出固定策略。  
4. **表格降级**：移动端改卡片列表或行内换行模式，避免全部字段被省略。  
5. **CLG 单列化**：Cover Letter 页面在移动端切换为单列分段流程。

