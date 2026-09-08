# anbing-image-upload

将 Obsidian 中的图片上传到 S3-compatible 对象存储、GitHub 或 GitLab，并把笔记中的图片链接替换为公开访问 URL。

当前支持 AWS S3、Cloudflare R2、七牛云 S3、MinIO、GitHub 和 GitLab。

GitHub/GitLab 存储目前要求目标仓库或项目为公开状态，并通过官方 API 将每张图片作为一次提交写入。Git 仓库不适合作为无限容量的对象存储，请注意仓库体积、提交历史和 API 限流。

## 功能

- 上传当前光标所在的本地图片。
- 从 Vault 中选择图片上传。
- 批量上传当前文档中的全部本地图片。
- 粘贴图片时自动上传到对象存储。
- 将 Wiki-link 或 Markdown 图片统一转换为标准 Markdown 图片语法。
- 上传成功后使用 UUID 文件名，避免远程对象重名覆盖。
- 可选择将本地文件重命名为远程 UUID 文件名。
- 可选择上传成功后将本地文件移入 Obsidian 回收站。
- 上传失败时默认保留本地图片，并显示具体失败原因。
- 批量上传时显示进度和失败文件明细。

## 使用前提

- 当前版本仅支持桌面端。
- Obsidian 版本要求为 `1.11.4` 或更高版本。
- 对象存储需要提供 S3-compatible API。
- 公开 URL 前缀对应的 Bucket、域名或 CDN 必须允许图片公开访问。
- 插件不会自动修改 Bucket 权限、公开读权限或 CORS 配置。

## 安装

### 手动安装

将以下文件复制到：

```text
你的 Vault/.obsidian/plugins/obsidian-image-upload/
```

```text
main.js
manifest.json
styles.css（如果存在）
```

然后在 Obsidian 中打开：

**设置 → 社区插件 → 已安装插件 → Obsidian Image Upload**

启用插件即可。

### 开发构建

```bash
npm install
npm run build
```

开发监听模式：

```bash
npm run dev
```

## 配置

打开插件设置，填写以下配置。

| 配置项 | 说明 |
| --- | --- |
| Endpoint | S3-compatible API 地址，不是图片最终访问地址 |
| Region | 存储服务的区域，例如 `us-east-1` 或 R2 的 `auto` |
| Bucket | Bucket 或存储空间名称 |
| 公开 URL 前缀 | 图片最终访问地址，例如 `https://img.example.com` |
| 对象路径前缀 | S3 对象目录前缀，例如 `obsidian/images` |
| Access key ID | S3 访问密钥，保存在 Obsidian SecretStorage |
| Secret access key | S3 私密密钥，保存在 Obsidian SecretStorage |
| Session token | 临时凭证使用，可选 |
| 最大文件大小 | 单个图片允许上传的最大字节数 |
| 请求超时 | 单次网络请求超时时间 |
| 重试次数 | 网络失败时的重试次数，范围为 0 到 5 |
| Path-style Endpoint | 某些 S3-compatible 服务需要开启 |

### GitHub

选择 GitHub 后填写 Owner、Repository、Branch 和 Path Prefix，并配置一个具有仓库内容写入权限的 Token。仓库需要公开，默认使用 `raw.githubusercontent.com` 地址。也可以填写可选的 CDN 域名，例如 `https://cdn.jsdelivr.net` 或 `https://testingcf.jsdelivr.net`，此时图片地址会使用 jsDelivr 的 GitHub 加速格式。若希望使用 `raw.githubusercontent.com`，请将 CDN 域名留空。

### GitLab

选择 GitLab 后填写 Host、Project、Branch 和 Path Prefix，并配置一个具有项目写入权限的 Token。Project 支持项目 ID 或 `namespace/project`，项目需要公开，图片链接使用 GitLab Raw 地址。

GitHub 和 GitLab Token 只保存在 Obsidian SecretStorage，不会写入 `data.json` 或图片 URL。连接测试只验证项目访问和分支，不会创建测试提交。

### 默认策略

- 粘贴自动上传：关闭。
- 上传成功后重命名本地文件：开启。
- 上传成功后删除本地文件：关闭。
- 上传失败时回退到本地保存：开启。
- 不覆盖同名远程对象，使用 UUID 文件名。
- 远程图片按公开 URL 处理。

## 存储服务配置示例

### AWS S3

```text
Endpoint: https://s3.amazonaws.com
Region: us-east-1
Bucket: my-images
公开 URL 前缀: https://cdn.example.com
Path-style Endpoint: 关闭
```

### Cloudflare R2

```text
Endpoint: https://<account-id>.r2.cloudflarestorage.com
Region: auto
Bucket: my-images
公开 URL 前缀: https://img.example.com
Path-style Endpoint: 通常关闭
```

R2 的 Access key 和 Secret access key 使用 R2 API Token 提供的凭证。Endpoint 使用 R2 S3 API 地址，不能填写自定义域名。

### 七牛云 S3

```text
Endpoint: https://<region>.s3.qiniucs.com
Region: 以七牛控制台或文档提供的区域为准
Bucket: 七牛空间名称
公开 URL 前缀: https://img.example.com
```

七牛的 Endpoint 和图片访问域名通常不同。Endpoint 用于上传，公开 URL 前缀用于 Markdown 图片访问。

### MinIO

```text
Endpoint: https://minio.example.com
Region: us-east-1
Bucket: images
公开 URL 前缀: https://minio.example.com/images
Path-style Endpoint: 根据 MinIO 部署配置决定
```

## 使用方法

### 编辑器命令

打开命令面板，执行以下命令：

#### Upload current image

将光标放在本地图片引用上，上传当前图片并替换链接。

支持：

```markdown
![[image.png]]
```

以及：

```markdown
![图片说明](image.png)
```

上传后统一转换为：

```markdown
![image.png](https://img.example.com/obsidian/images/2026/09/UUID.png)
```

#### Upload image file

打开 Vault 图片搜索窗口，选择图片后上传，并在当前光标位置插入远程 Markdown 图片。

#### Upload all document images

扫描当前文档中的全部本地图片，逐个上传并替换链接。右上角通知会显示上传进度，例如：

```text
正在上传图片 3/8...
```

上传完成后会显示成功和失败数量；失败通知会列出失败文件和具体原因。

### 编辑器右键菜单

在 Markdown 编辑器中右键选择：

```text
图片上传
├─ 上传当前图片到 S3
├─ 选择图片上传到 S3
└─ 上传当前文档的所有图片
```

### 粘贴图片自动上传

在插件设置中开启：

```text
粘贴图片时自动上传
```

之后粘贴板中的图片会：

1. 保存到当前 Markdown 文件所在目录。
2. 上传到 S3。
3. 在当前光标位置插入远程 Markdown 图片。

关闭该选项时，插件不会拦截粘贴事件，保留 Obsidian 默认行为。

## 本地文件策略

### 重命名本地文件

开启“上传成功后重命名本地文件”时：

```text
上传前：photo.png
上传后：32cb76a3-b67a-4649-8828-eac3ed1f5120.png
```

远程 S3 对象和本地文件使用相同的 UUID 文件名。

关闭该选项时，本地文件保留原文件名，但 Markdown 链接仍会替换为远程 URL。

### 删除本地文件

开启“上传成功后删除本地文件”后，只有在上传成功并完成链接替换后，本地文件才会被移入 Obsidian 回收站。

上传失败时不会删除本地文件。

## 失败处理

- 配置错误、文件格式错误或文件过大：不会修改笔记。
- S3 上传失败：保留本地文件。
- 粘贴上传失败且开启回退：插入本地 Markdown 图片。
- 粘贴上传失败且关闭回退：删除本次自动创建的本地文件。
- 批量上传失败：继续处理其他图片，并在结束时列出失败文件和原因。

详细的脱敏错误信息会输出到 Obsidian 开发者工具 Console，日志前缀为：

```text
[obsidian-image-upload]
```

打开开发者工具：`Ctrl + Shift + I`。

## 安全说明

- Access key、Secret access key 和 Session token 使用 Obsidian SecretStorage 保存。
- 插件不会把凭证写入普通插件配置文件。
- 任何拥有本机 Vault 或 Obsidian 配置访问权限的用户，都可能访问本地凭证。
- 建议使用专用 Bucket、专用前缀和最小权限的访问密钥。
- 当前版本按公开 URL 设计，不支持私有 Bucket、签名访问 URL 或临时预签名上传。
- 不要将 Access key、Secret access key 或 Session token 提交到 Git 仓库。

## 限制与后续计划

当前限制：

- 仅支持桌面端。
- 远程 URL 默认必须可公开访问。
- 暂不支持私有 Bucket 和签名 URL。
- 暂不提供全库图片迁移。

后续计划：

- 私有 Bucket 和签名 URL。
- 预签名上传和临时凭证。
- 全库批量迁移。
- 图片压缩和格式转换。
- 移动端支持。

## 验证命令

```bash
npm run build
npm run lint
```

`lint` 当前可能提示设置页未接入 Obsidian 1.13+ 的设置搜索声明式 API，该提示不影响插件运行。
