# Bandi Logo 设计说明

## 1. 设计定位

Bandi 是面向多个长期 Agent 的可视化配置管理产品，负责按 Team 管理 Agent、可选的 Team-scoped TaskBrief，以及 Instructions、Skills、Agent 长期 Memory、Rules、MCP 和权限等长期配置资产。

Logo 不直接描绘终端、节点、组织架构或任务流程，而是用一个完整、稳定的抽象实体表达 Bandi 的品牌特征：

- **包覆**：外层连续形体代表长期、可靠的配置边界；
- **连接**：连续折叠关系代表 Agent 与配置资产之间的关联；
- **映射**：内部开放负空间代表多种配置关系被组织成清晰结构；
- **管理**：集中、平衡的单体轮廓代表多个 Agent 被统一管理；
- **Bandi**：右侧内缘的双弧节奏克制地暗示字母 `B`，但不把 Logo 处理成直接字标。

整体采用圆润但不柔软的抽象 3D 造型，使品牌既有亲和力，也保持桌面生产力工具所需的稳重与专业感。

## 2. 视觉原则

### 黑白与灰阶

Logo 只使用黑、白和由真实体积光照形成的灰阶，不使用品牌强调色。灰阶用于表现折面、厚度和空间关系，不能额外添加高光、金属反射或彩色渐变。

### 亮暗主题

- **亮色主题**：使用透明背景的深色主体；
- **暗色主题**：使用相同透明轮廓的浅色主体；
- 两个版本的 Alpha 完全一致，浅色版仅对主体 RGB 进行黑白反相，以保留反向的 3D 层次；
- 不使用 CSS `filter` 临时生成正式品牌资产，也不根据系统主题自动选择版本；应用内始终服从 Bandi 当前主题。

### 透明与阴影

Web 主标为透明背景，中央开口同样透明。原始概念图中的白色摄影背景和落地阴影不属于 Logo 结构，正式透明资产不保留它们。

## 3. 使用场景

### Web 应用

应用快捷栏和展开导航使用透明主题版本：

- 亮色界面使用深色主体；
- 暗色界面使用浅色主体；
- 图形作为装饰时使用空 `alt`，可访问名称由外层链接或相邻文字提供。

### Favicon

Favicon 使用白色底和深色 Logo。小尺寸下优先保证外轮廓与中央开口清晰，不追求完整呈现细微灰阶。

### 桌面应用图标

桌面图标固定使用白色圆角底和深色 Logo，不随系统主题变化：

- 1024 × 1024 画布；
- 圆角外保持透明；
- Logo 居中，四周保留约 12%–15% 安全区；
- 平台 PNG、ICNS 和 ICO 均由 `app-icon.svg` 统一生成。

## 4. 尺寸与留白

- Web 快捷栏建议图形尺寸不小于 28px；
- 常规 UI 场景建议不小于 24px；
- 低于 24px 时应使用 favicon 的高对比小尺寸表达；
- Logo 四周至少保留其外接正方形边长 12% 的空白；
- 不让图形紧贴按钮、卡片、窗口或图标遮罩边缘。

## 5. 禁止事项

不得：

- 拉伸、压扁、旋转或改变既有比例；
- 改成任意品牌色、彩色渐变或金属材质；
- 添加重投影、发光、描边或额外装饰；
- 填死中央负空间；
- 将亮色版与暗色版混用，造成背景对比不足；
- 将 Logo 与终端、节点、方向盘、机器人等功能图标拼接；
- 在正式资产中重新生成近似图形替代当前母版。

## 6. 本机工作台标识边界

设置中的自定义工作台 Logo 是当前设备的辅助标识，不是 Bandi Logo 变体：

- 正式 `BrandMark`、产品名 Bandi、favicon、Dock / 桌面图标和系统菜单不被替换；
- 自定义标识只出现在工作台辅助品牌区域，保存在桌面应用数据区的固定 `logo` 槽位；
- Team 专属 Logo 如未来支持，应作为独立业务资产建模，不得复用本机工作台标识或覆盖 Bandi 品牌；
- 本机标识不进入 Agent 配置、配置版本、备份、Git 或跨设备同步。

## 7. 品牌资产

| 用途 | 文件 |
| --- | --- |
| 设计母版 | `assets/brand/bandi-logo-master.png` |
| Web 亮色主题 | `apps/web/src/assets/brand/bandi-mark-dark.png` |
| Web 暗色主题 | `apps/web/src/assets/brand/bandi-mark-light.png` |
| Web favicon | `apps/web/public/favicon.png` |
| Web 品牌组件 | `apps/web/src/components/app/brand-mark.tsx` |
| 桌面图标源 | `apps/desktop/src-tauri/app-icon.svg` |
| 桌面平台图标 | `apps/desktop/src-tauri/icons/` |

## 8. 维护方式

若未来调整 Logo，应先更新透明主题资产，再同步检查 Web 快捷栏、展开导航、favicon、32px/128px PNG、macOS ICNS 与 Windows ICO。桌面图标统一从源文件生成：

```bash
pnpm exec tauri icon \
  apps/desktop/src-tauri/app-icon.svg \
  --output apps/desktop/src-tauri/icons
```

该命令还会生成移动端及 Windows Store 的额外尺寸；当前产品未使用的产物不应提交。
