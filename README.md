# anbing‑image‑upload
Upload images in Obsidian to AWS S3 or other S3‑API‑compatible object‑storage services, and replace image links in notes with public‑access URLs.

Currently supports AWS S3, Cloudflare R2, Qiniu S3‑compatible API, MinIO and other storage services offering S3‑compatible APIs.

## Features
‑ Upload the local image under the current cursor position.
‑ Select images from Vault for upload.
‑ Batch‑upload all local images within the current document.
‑ Auto‑upload images to object storage when pasting images.
‑ Convert both Wiki‑links and Markdown image syntax into standard Markdown image format.
‑ Use UUID‑based filenames after successful upload to avoid overwriting remote objects with identical names.
‑ Optional: rename local files to match remote UUID filenames.
‑ Optional: move local files to Obsidian Recycle Bin upon successful upload.
‑ Keep local images by default when upload fails, and display detailed failure reasons.
‑ Show progress statistics and failed‑file details during batch uploads.

## Prerequisites
‑ This release supports desktop‑only.
‑ Obsidian version: `1.11.4` or higher.
‑ Object storage must expose S3‑compatible API endpoints.
‑ The bucket, domain or CDN corresponding to the public‑URL prefix must allow public image access.
‑ This plugin **will not automatically modify bucket permissions, public‑read access or CORS configurations**.

## Installation
### Manual Installation
Copy the following files into this directory:
```text
Your Vault/.obsidian/plugins/obsidian‑image‑upload/
```
```text
main.js
manifest.json
styles.css (if present)
```

Then open Obsidian:
**Settings → Community plugins → Installed plugins → Obsidian Image Upload**
Enable the plugin.

### Development Build
```bash
npm install
npm run build
```

Development watch mode:
```bash
npm run dev
```

## Configuration
Open plugin settings and fill in the options below.

| Config Item | Description |
|---|---|
| Endpoint | S3‑compatible API endpoint, NOT the final public image access URL |
| Region | Storage service region, e.g. `us‑east‑1`, or `auto` for R2 |
| Bucket | Bucket / storage‑space name |
| Public URL Prefix | Final public image access base URL, e.g. `https://img.example.com` |
| Object Path Prefix | S3 object directory prefix, e.g. `obsidian/images` |
| Access key ID | S3 access key ID, stored inside Obsidian SecretStorage |
| Secret access key | S3 secret access key, stored inside Obsidian SecretStorage |
| Session token | For temporary credentials, optional |
| Max File Size | Maximum allowed bytes for a single image file |
| Request Timeout | Timeout for each individual network request |
| Retry Count | Retry attempts for network failures, range: 0‑5 |
| Path‑style Endpoint | Enable for certain S3‑compatible storage providers |

### Default Policies
‑ Auto‑upload on paste: **Disabled**
‑ Rename local files after successful upload: **Enabled**
‑ Delete local files after successful upload: **Disabled**
‑ Fallback to local files on upload failure: **Enabled**
‑ Never overwrite remote objects with identical names; use UUID filenames.
‑ Remote images are processed via their public URLs.

## Storage‑provider Configuration Samples
### AWS S3
```text
Endpoint: https://s3.amazonaws.com
Region: us‑east‑1
Bucket: my‑images
Public URL Prefix: https://cdn.example.com
Path‑style Endpoint: Off
```

### Cloudflare R2
```text
Endpoint: https://<account‑id>.r2.cloudflarestorage.com
Region: auto
Bucket: my‑images
Public URL Prefix: https://img.example.com
Path‑style Endpoint: Usually Off
```
> For R2, use credentials provided by R2 API Token for Access‑key / Secret‑access‑key. Supply the official R2 S3‑API address as Endpoint; do NOT fill in your custom domain.

### Qiniu S3‑compatible API
```text
Endpoint: https://<region>.s3.qiniucs.com
Region: Region value from Qiniu console / official docs
Bucket: Qiniu bucket name
Public URL Prefix: https://img.example.com
```
> Qiniu Endpoint is used for uploading; the public‑URL prefix serves Markdown image access. These two values are normally different.

### MinIO
```text
Endpoint: https://minio.example.com
Region: us‑east‑1
Bucket: images
Public URL Prefix: https://minio.example.com/images
Path‑style Endpoint: Determined by your MinIO deployment settings
```

## Usage
### Editor Commands
Open Command Palette and run the commands below.

#### Upload current image to S3
Place your cursor on a local‑image reference, then upload and replace its link.
Supports Wiki‑link syntax:
```markdown
![[image.png]]
```
And standard Markdown syntax:
```markdown
![Image alt](image.png)
```

After upload it will be converted into:
```markdown
![image.png](https://img.example.com/obsidian/images/2026/09/UUID.png)
```

#### Upload image file to S3
Open Vault image selector window, pick an image to upload. The remote Markdown‑image markup will be inserted at your cursor position.

#### Upload all document images to S3
Scan all local images within current document, upload each one and replace links. Progress will show in the top‑right notification, example:
```text
Uploading image 3/8...
```
After completion, counts for succeeded / failed items will be shown; failed notifications list filenames and root causes.

### Editor Right‑click Menu
Right‑click inside Markdown editor:
```text
Image Upload
├─ Upload current image to S3
├─ Select and upload image to S3
└─ Upload all images in current document
```

### Auto‑Upload On Paste
Turn on this toggle inside plugin settings:
```text
Auto‑upload images on paste
```

When enabled for pasted clipboard images:
1. Save image file into the same directory as current Markdown note.
2. Upload file to S3 object storage.
3. Insert remote Markdown‑image markup at cursor position.

When disabled, the plugin does not intercept paste events, keeping Obsidian native paste behaviour.

## Local‑file Handling Policies
### Rename Local Files
If `Rename local files after successful upload` is enabled:
```text
Before upload: photo.png
After upload: 32cb76a3‑b67a‑4649‑8828‑eac3ed1f5120.png
```
Remote S3 object and local file share the identical UUID filename.

If disabled: local files retain original filenames, but Markdown links will still point to remote public URLs.

### Delete Local Files
If `Delete local files after successful upload` is enabled:
Local files are moved to Obsidian Recycle Bin **only after upload succeeds and link replacement finishes**.
Local files remain untouched upon upload failure.

## Failure‑handling Behaviours
‑ Invalid configuration, bad file format or oversized file: notes will remain unmodified.
‑ S3 upload failure: local image files are preserved.
‑ Paste‑upload fails and fallback enabled: insert local Markdown‑image markup.
‑ Paste‑upload fails and fallback disabled: delete the locally‑created temporary image file generated during paste.
‑ Batch upload failure: continue processing remaining images; summary lists failed files and reasons at completion.

Redacted detailed error logs print to Obsidian Developer‑tools Console with log prefix:
```text
[obsidian‑image‑upload]
```
Open developer tools: `Ctrl + Shift + I`.

## Security Notes
‑ Access key, Secret access key and Session token are persisted by Obsidian SecretStorage.
‑ Credentials are NOT written into plain‑text plugin‑setting JSON files.
‑ Any user gaining filesystem access to your Vault or Obsidian configuration may retrieve locally‑saved credentials.
‑ It is recommended to use a dedicated bucket, dedicated object‑path prefix and access keys with minimal‑possible permissions.
‑ This version is built for public‑accessible URLs. Private buckets, signed‑access URLs and pre‑signed uploads are **not supported**.
‑ Never commit Access‑key / Secret‑access‑key / Session‑token values into Git repositories.

## Current Limitations & Roadmap
Current limitations:
‑ Desktop‑only support.
‑ Remote URLs must be publicly accessible.
‑ Private buckets and signed URLs are unsupported.
‑ Vault‑wide bulk image migration is unavailable.

Future roadmap:
‑ Support private buckets and signed URLs.
‑ Pre‑signed uploads and temporary‑credential workflows.
‑ Vault‑wide bulk‑migration feature.
‑ Image compression & format conversion.
‑ Mobile‑platform support.

## Validation Scripts
```bash
npm run build
npm run lint
```
> The `lint` step may emit warnings about missing Obsidian 1.13+ setting‑search declarative‑API declarations; such warnings do **not** block plugin runtime functionality.