# 豆包批量删除对话记录（非官方）

> ⚠️ **本项目与豆包/字节跳动无关，为个人开发的第三方工具。**

## 功能

- 扫描豆包网页版左侧栏所有历史对话（支持项目文件夹分类、折叠展开）
- 多选对话，**批量删除**（API 直调，无需逐条点击）
- 多选对话，**批量导出**为 Markdown 文件
- 单个对话直接导出 `.md`，多个对话自动打包为 `.zip` 压缩包（使用 JSZip）
- 支持搜索过滤、全选/反选/全不选
- 每个对话支持单独导出、在新标签页打开
- 暗色/亮色主题切换
- 可调节扫描间隔速度
- 删除/导出过程中可随时停止

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 点击 Tampermonkey 图标 → 管理面板 → **+** 新建脚本
3. 删除编辑器默认内容，将 `豆包批量删除对话_v3_dev.user.js` 全部内容粘贴进去
4. 按 `Ctrl+S` 保存
5. 打开 [www.doubao.com](https://www.doubao.com)，页面右上角出现面板即安装成功

## 使用方法

1. 点击 **「扫描对话」** → 弹窗显示所有对话列表
2. 勾选需要操作的对话（支持搜索关键词过滤）
3. 点击 **「🗑️ 删除选中」** 或 **「📥 导出选中」**
4. 删除/导出过程中可随时点击 **「⏹ 停止」**

### 弹窗操作

| 操作 | 说明 |
|------|------|
| 全选(最近) | 只选中「最近」区域的全部对话 |
| 全不选 | 取消所有勾选 |
| 反选 | 反转当前勾选状态 |
| 搜索框 | 按标题关键词实时过滤 |
| 📥 图标 | 单独导出该对话 |
| ↗ 图标 | 在新标签页打开该对话 |
| 📁 文件夹 | 点击展开/折叠项目文件夹 |

### 导出说明

- 选中 1 个对话：直接下载 `.md` 文件
- 选中多个对话：自动打包为 `.zip` 压缩包
- 导出的 Markdown 格式：
  - 用户问题以 `## 我: 问题内容` 为标题
  - 豆包回答以 `## 👧 回答` 为标题，保留原始排版
  - 回答中的子标题自动降级，层级清晰

### 面板设置

- **扫描间隔**：控制滚动加载的间隔时间（100-3000ms），默认 400ms
- **主题**：点击按钮切换暗色/亮色主题

## 注意事项

- 脚本通过 API 直调实现删除，与页面操作效果相同
- **「主对话」和「服务通知」** 为系统内置对话，自动跳过
- 删除操作不可恢复，请谨慎选择
- 导出功能依赖豆包 API，需要在登录状态下使用
- 连续失败 5 次会自动停止，防止无效请求
- 建议先小批量测试，确认无误后再批量操作

---

## 更新日志

### 3.1-dev

- 修复：适配豆包新版对话栏 DOM，解决扫描后弹窗列表为空的问题
  - 分组标题判断改为读取 `div[role="button"] > span`（旧版 `<button>` 标题已失效）
  - 标题提取改为取可见标题 span，避免测量用隐藏 span 造成文本重复（如「主对话主对话主对话」）
- 兼容保留项目文件夹（`data-project-id`）分组逻辑

### 3.0-dev

- 批量删除 + 批量导出（API 直调）
- 单个导出 Markdown，多个打包 zip
- 搜索过滤、全选/反选、主题切换

---

## 免责声明

1. 本脚本为开源免费工具，仅供个人学习和使用，**与豆包/字节跳动无任何关联**。
2. 本脚本仅自动化浏览器中的用户操作，**不破解、不绕过任何安全机制**。
3. **使用者应自行承担使用本脚本产生的一切后果。** 包括但不限于：误删对话记录、账号异常、数据丢失等。
4. 使用本脚本前，**请确认你已了解其功能和风险**。如有重要数据，请先导出备份。
5. 本脚本按「现状」提供，**不作任何明示或暗示的保证**。作者不保证脚本的准确性、完整性、可靠性或持续可用性。
6. 豆包平台的接口、页面结构可能随时变更，**脚本可能因平台更新而失效**，作者不保证及时更新维护。
7. **因使用本脚本导致的任何直接、间接、偶然、特殊或后果性的损害，作者不承担任何责任。**
8. 使用本脚本即表示你已阅读、理解并同意本免责声明的全部内容。

**如果你不同意以上条款，请勿使用本脚本。**

## 许可证

MIT License

## Disclaimer

1. This script is an open-source free tool for personal learning and use only. **It is not affiliated with Doubao / ByteDance in any way.**
2. This script only automates user operations in the browser. **It does not bypass any security mechanisms.**
3. **Users should bear all consequences of using this script**, including but not limited to: accidentally deleting conversation records, account anomalies, data loss, etc.
4. Before using this script, **please make sure you understand its functions and risks**. If you have important data, please export and back it up first.
5. This script is provided "as is" **without any warranty, express or implied**. The author does not guarantee the accuracy, completeness, reliability, or continued availability of the script.
6. Doubao's interfaces and page structure may change at any time. **The script may become unavailable due to platform updates.** The author does not guarantee timely updates or maintenance.
7. **The author shall not be liable for any direct, indirect, incidental, special, or consequential damages arising from the use of this script.**
8. By using this script, you have read, understood, and agreed to all the terms of this disclaimer.

**If you do not agree to the above terms, please do not use this script.**
