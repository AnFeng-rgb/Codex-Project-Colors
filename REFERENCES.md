# 第三方许可与参考

启动控制器 `src/startup/controller.mjs` 和原生桥 `src/macos/StartupBridge.m` 适配自 [jaykinhoo9/codex-usage-badge](https://github.com/jaykinhoo9/codex-usage-badge) 的启动观察实现，对应研究提交 `d014efcd7735a4349576c6b424cac23b614f9115`。版权属于 Codex Usage Badge contributors，适用 MIT；完整通知在源码 `third-party/codex-usage-badge-LICENSE` 与应用 `Contents/Resources/STARTUP-LICENSE` 中。

适配移除了原项目 Dock 修复功能，保留仅对新启动、未操作的前台应用受控重开及原生动作前再次校验；本项目实现安装、内置运行环境、配色保存、窗口选择与停用卸载。没有附带原项目额度界面、安装器、研究资料或图片。

内置 Node.js v24.21.0 来自 Node 官方发布，构建时检查 SHA256；其完整版权和第三方许可保留在应用 `Contents/Resources/NODE-LICENSE` 中。

官方客户端和 Codex 名称属于各自权利人。本工具不是 OpenAI 官方发布或支持的插件。
