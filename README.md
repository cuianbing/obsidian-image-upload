# Obsidian Image Upload

当前版本已完成阶段一：S3 配置与上传策略。插件使用 AWS SDK v3 连接 AWS S3 或兼容 S3 API 的对象存储，后续阶段会在此基础上加入图片上传和 Markdown 链接替换。

阶段二已完成图片上传核心服务：插件可以读取 Vault 中的图片文件，校验格式和大小，使用日期目录与 UUID 生成唯一对象 key，通过 AWS SDK v3 上传，并返回公开访问 URL。上传成功后，本地文件会重命名为远程对象的唯一文件名。编辑器命令、粘贴监听和 Markdown 替换将在后续阶段接入该服务。

阶段三当前提供两个编辑器命令：

- **Upload current image to S3**：将光标放在本地图片引用上，上传对应 Vault 图片，并将当前引用替换为公开 Markdown 图片链接。
- **Upload image file to S3**：打开 Vault 图片搜索，选择图片后上传，并在当前光标位置插入公开 Markdown 图片链接。

上传失败时不会修改笔记，也不会删除本地文件；开启删除选项后，上传成功才会将本地文件移入 Obsidian 回收站。

## 阶段一功能

- 配置 S3 Endpoint、Region、Bucket、公开 URL 前缀和对象路径前缀。
- 使用 Obsidian SecretStorage 保存 access key、secret access key 和可选 session token。
- 在设置页测试 Bucket 访问权限和临时对象上传/清理。
- 配置粘贴自动上传、上传成功后删除本地文件、失败回退和通知策略。
- 使用 AWS SDK v3 完成签名、重试和 S3 命令，并通过 Obsidian `requestUrl()` 发送请求，避免插件 Fetch 环境的 CORS 限制。
- 图片支持 PNG、JPEG、GIF、WebP、SVG、AVIF 和 BMP。
- 默认使用 `对象前缀/YYYY/MM/UUID.扩展名`，并将本地文件重命名为 `UUID.扩展名`，不会覆盖同名对象。
- 上传前校验最大文件大小，上传后返回配置中的公开 URL 前缀和对象 key。

## 使用前提

- 当前版本面向桌面端，移动端暂不支持。
- 远程 URL 默认按公开访问设计；Bucket 或 CDN 的公开读权限需要用户自行配置，插件不会修改 Bucket 权限或 CORS。
- 测试上传会写入对象路径下的 `.plugin-test/` 临时对象，并在成功后尝试删除。
- 上传失败时默认保留本地图片；上传成功后默认不删除本地文件。
- 可在设置中控制上传成功后是否将本地文件重命名为远程 UUID 文件名，默认开启。
- Secret key 保存在 Obsidian SecretStorage 中，但拥有本地配置访问权限的用户仍可能访问该凭证。后续可以增加预签名 URL 或临时凭证方案。

## 配置

在 **设置 → 社区插件 → Obsidian Image Upload** 中填写 S3 配置，然后使用“测试连接”和“测试上传”确认权限。建议使用专用 Bucket 或前缀，并只授予必要的对象读写权限。

后续版本计划支持私有 Bucket、批量迁移、图片压缩和移动端。

---

以下是官方脚手架说明。

This is a sample plugin for Obsidian (https://obsidian.md).

This project uses TypeScript to provide type checking and documentation.
The repo depends on the latest plugin API (obsidian.d.ts) in TypeScript Definition format, which contains TSDoc comments describing what it does.

This sample plugin demonstrates some of the basic functionality the plugin API can do.

- Adds a ribbon icon, which shows a Notice when clicked.
- Adds a command "Open modal (simple)" which opens a Modal.
- Adds a plugin setting tab to the settings page.
- Registers a global click event and outputs a Notice on click.
- Registers a global interval which logs 'setInterval' to the console.

## First time developing plugins?

Quick starting guide for new plugin devs:

- Check if [someone already developed a plugin for what you want](https://obsidian.md/plugins)! There might be an existing plugin similar enough that you can partner up with.
- Make a copy of this repo as a template with the "Use this template" button (login to GitHub if you don't see it).
- Clone your repo to a local development folder. For convenience, you can place this folder in your `.obsidian/plugins/your-plugin-name` folder.
- Install NodeJS, then run `npm i` in the command line under your repo folder.
- Run `npm run dev` to compile your plugin from `src/main.ts` to `main.js`.
- Make changes to `src/main.ts` (or create new `.ts` files). Those changes should be automatically compiled into `main.js`.
- Reload Obsidian to load the new version of your plugin.
- Enable plugin in settings window.
- For updates to the Obsidian API run `npm update` in the command line under your repo folder.

## Releasing new releases

- Update your `manifest.json` with your new version number, such as `1.0.1`, and the minimum Obsidian version required for your latest release.
- Update your `versions.json` file with `"new-plugin-version": "minimum-obsidian-version"` so older versions of Obsidian can download an older version of your plugin that's compatible.
- Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix `v`. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases
- Upload the files `manifest.json`, `main.js`, `styles.css` as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.
- Publish the release.

> You can simplify the version bump process by running `npm version patch`, `npm version minor` or `npm version major` after updating `minAppVersion` manually in `manifest.json`.
> The command will bump version in `manifest.json` and `package.json`, and add the entry for the new version to `versions.json`

## Adding your plugin to the community plugin list

- Check the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines).
- Publish an initial version.
- Make sure you have a `README.md` file in the root of your repo.
- Make a pull request at https://github.com/obsidianmd/obsidian-releases to add your plugin.

## How to use

- Clone this repo.
- Make sure your NodeJS is at least v18 (`node --version`).
- `npm i` to install dependencies.
- `npm run dev` to start compilation in watch mode.

## Manually installing the plugin

- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/your-plugin-id/`.

## Improve code quality with eslint

- [ESLint](https://eslint.org/) is a tool that analyzes your code to quickly find problems. You can run ESLint against your plugin to find common bugs and ways to improve your code.
- This project already has eslint preconfigured, you can invoke a check by running`npm run lint`
- Together with a custom eslint [plugin](https://github.com/obsidianmd/eslint-plugin) for Obsidan specific code guidelines.
- A GitHub action is preconfigured to automatically lint every commit on all branches.

## Funding URL

You can include funding URLs where people who use your plugin can financially support it.

The simple way is to set the `fundingUrl` field to your link in your `manifest.json` file:

```json
{
	"fundingUrl": "https://buymeacoffee.com"
}
```

If you have multiple URLs, you can also do:

```json
{
	"fundingUrl": {
		"Buy Me a Coffee": "https://buymeacoffee.com",
		"GitHub Sponsor": "https://github.com/sponsors",
		"Patreon": "https://www.patreon.com/"
	}
}
```

## API Documentation

See https://docs.obsidian.md
