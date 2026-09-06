import { App, TFile } from 'obsidian';
import { normalizeS3Error, S3OperationError } from './errors';
import { S3ClientService } from './s3-client';
import { ImageUploadResult, ImageUploadSettings } from './types';

const MIME_TYPES: Record<string, string> = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	svg: 'image/svg+xml',
	webp: 'image/webp',
};

export class ImageUploadService {
	/** 保存 Vault 和 S3 客户端依赖，供后续编辑器命令复用。 */
	constructor(
		private readonly app: App,
		private readonly s3Client: S3ClientService,
		private readonly getSettings: () => ImageUploadSettings,
	) {}

	/** 读取并上传 Vault 中的图片文件，返回可插入 Markdown 的公开 URL。
	 * @param file Vault 中待上传的图片文件。
	 * @returns 对象 key、公开 URL、MIME 类型、字节数和请求 ID。
	 * @throws S3OperationError 当文件无效、超过大小限制、读取失败或上传失败时抛出。
	 */
	async uploadFile(file: TFile): Promise<ImageUploadResult> {
		const settings = this.getSettings();
		const contentType = getImageContentType(file.extension);
		if (!contentType) {
			throw configurationError(`不支持的图片格式：${file.extension || '未知'}。`);
		}
		if (file.stat.size > settings.maxFileSize) {
			throw configurationError(`图片超过大小限制：${formatBytes(settings.maxFileSize)}。`);
		}
		if (!settings.publicUrlPrefix.trim()) {
			throw configurationError('请先配置公开 URL 前缀。');
		}

		try {
			const arrayBuffer = await this.app.vault.readBinary(file);
			const body = new Uint8Array(arrayBuffer);
			const key = createObjectKey(settings.objectKeyPrefix, file.extension);
			const response = await this.s3Client.uploadObject(settings, key, body, contentType);
			return {
				key,
				url: createPublicUrl(settings.publicUrlPrefix, key),
				contentType,
				bytes: body.byteLength,
				requestId: response.requestId,
				localPath: file.path,
			};
		} catch (error) {
			if (error instanceof S3OperationError) throw error;
			throw new S3OperationError(normalizeS3Error(error));
		}
	}

	/** 将已成功上传的本地文件重命名为远程对象的唯一文件名。
	 * @param file 上传前的本地 Vault 文件。
	 * @param key 远程 S3 对象 key。
	 * @returns 重命名后的 Vault 文件对象。
	 */
	async renameFileToRemoteName(file: TFile, key: string): Promise<TFile> {
		return renameLocalFile(this.app, file, getObjectFilename(key));
	}
}

/** 根据文件扩展名返回允许上传的图片 MIME 类型。 */
function getImageContentType(extension: string): string | undefined {
	return MIME_TYPES[extension.toLowerCase()];
}

/** 使用日期目录和 UUID 生成不会覆盖已有对象的图片 key。 */
function createObjectKey(prefix: string, extension: string): string {
	const now = new Date();
	const datePath = [now.getUTCFullYear(), now.getUTCMonth() + 1]
		.map((part) => String(part).padStart(2, '0'))
		.join('/');
	const cleanPrefix = trimSlashes(prefix);
	const filename = `${crypto.randomUUID()}.${extension.toLowerCase()}`;
	return `${cleanPrefix ? `${cleanPrefix}/` : ''}${datePath}/${filename}`;
}

/** 将对象 key 拼接到公开 URL 前缀，并对每个路径片段进行编码。 */
function createPublicUrl(publicUrlPrefix: string, key: string): string {
	const prefix = publicUrlPrefix.replace(/\/+$/, '');
	const encodedKey = key.split('/').map((part) => encodeURIComponent(part)).join('/');
	return `${prefix}/${encodedKey}`;
}

/** 从远程对象 key 中提取唯一文件名。
 * @param key 远程 S3 对象 key。
 * @returns key 最后一个路径片段，即远程文件名。
 */
function getObjectFilename(key: string): string {
	return key.split('/').at(-1) ?? key;
}

/** 将本地文件重命名为远程对象的唯一文件名，并返回更新后的文件对象。
 * @param app 当前 Obsidian App 实例。
 * @param file 上传前的本地 Vault 文件。
 * @param filename 远程对象对应的唯一文件名。
 * @returns 重命名后的 Vault 文件对象。
 * @throws S3OperationError 目标文件已存在或重命名后无法定位文件时抛出。
 */
async function renameLocalFile(app: App, file: TFile, filename: string): Promise<TFile> {
	if (file.name === filename) return file;
	const parentPath = file.parent?.path ?? '';
	const newPath = parentPath ? `${parentPath}/${filename}` : filename;
	const existing = app.vault.getAbstractFileByPath(newPath);
	if (existing && existing !== file) {
		throw configurationError(`本地文件重命名失败，目标文件已存在：${filename}。`);
	}
	await app.fileManager.renameFile(file, newPath);
	const renamedFile = app.vault.getAbstractFileByPath(newPath);
	if (!(renamedFile instanceof TFile)) {
		throw configurationError(`本地文件重命名后无法找到文件：${filename}。`);
	}
	return renamedFile;
}

/** 去除路径前缀首尾斜杠，避免生成双斜杠。 */
function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}

/** 将字节数格式化为适合通知展示的大小文本。 */
function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 创建配置类 S3 异常，避免把本地校验错误误报为网络错误。 */
function configurationError(message: string): S3OperationError {
	return new S3OperationError({ kind: 'configuration', message });
}
