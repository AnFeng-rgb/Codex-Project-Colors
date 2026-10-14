# 应用图标

`AppIcon.png` 是应用图标原图，采用内置 imagegen 生成，2026-10-14 保存。图案以六色文件夹表达项目配色，以绿色圆环表达剩余额度；外部保持透明。无文字、无 OpenAI 标志。

`npm run build:macos` 使用 macOS 的 sips 与 iconutil 生成从 16px 到 1024px 的十个标准图标尺寸，输出 AppIcon.icns 并在应用 Info.plist 中注册。生成文件保存在 release 内；源码包包含原图与转换脚本。

## 生成提示词

Use case: logo-brand. Asset type: production macOS application icon for a community app named Codex Project Colors, providing colored project folders and quota remaining display. Create ONE polished square 1024x1024 app icon, isolated with genuine transparent outside corners, ready for an .icns file. A deep midnight charcoal rounded square tile, large inside the canvas with a modest transparent margin. On the tile, one beautifully simple front-facing folder silhouette with six softly separated vivid color bands (red, orange, gold, green, blue, purple), solid clean colors, no pattern or grain, softly rounded folder edges. In the lower right portion of the folder, integrate a small clear emerald circular remaining-quota ring with a dark center, strong negative space, around three quarters complete. Refined restrained macOS style with very subtle depth, crisp geometric silhouette and excellent recognizability at 32px, no tiny details. Centered balanced composition, no external cast shadow, no letters, no numbers, no text, no watermark, no OpenAI logo, no screenshot or multiple variants. The folder is the dominant symbol; quota ring is secondary. Do not use rainbow backdrop or texture.
