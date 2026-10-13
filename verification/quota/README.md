# 额度界面检查

`browser.mjs` 在独立无头 Chrome 中构建受控界面，检查双按钮、200px 面板、深浅主题、临期提醒、独立显示开关、失败重试和完整清理。默认使用虚构数据，不连接 Codex、不读取账号、也不安装或重启后台。

普通单元检查直接运行 `npm test`，不需要 Playwright。可选界面检查需要 Playwright 和 Chrome：

```sh
npm install --no-save --package-lock=false playwright
npm run test:quota-ui
```

Mac 默认使用 `/Applications/Google Chrome.app`。其他浏览器安装路径可通过 `COLOR_LABELS_CHROME` 指定，已有 Playwright 模块可通过 `COLOR_LABELS_PLAYWRIGHT` 指定。运行结果和截图生成于本目录并由精确 Git 忽略规则排除。

`COLOR_LABELS_QUOTA_FIXTURE` 可选择额外的本机测试 JSON；不会作为程序分发数据，也不要上传私人账号采样。临期示例仅用于受控测试，不代表实际账号状态。
