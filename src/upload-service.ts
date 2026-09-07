import { App, TFile } from 'obsidian';
import { normalizeS3Error, StorageOperationError } from './errors';
import { StorageBackend } from './storage-backend';
import { ImageUploadResult, ImageUploadSettings, StorageCredentials } from './types';

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
	constructor(
		private readonly app: App,
		private readonly getBackend: () => StorageBackend,
		private readonly getCredentials: () => StorageCredentials,
		private readonly getSettings: () => ImageUploadSettings,
	) {}

	async uploadFile(file: TFile): Promise<ImageUploadResult> {
		const settings = this.getSettings();
		const contentType = getImageContentType(file.extension);
		if (!contentType) throw configurationError(`不支持的图片格式：${file.extension || '未知'}。`);
		if (file.stat.size > settings.maxFileSize) {
			throw configurationError(`图片超过大小限制：${formatBytes(settings.maxFileSize)}。`);
		}

		try {
			const body = new Uint8Array(await this.app.vault.readBinary(file));
			const key = createObjectKey(getRemotePathPrefix(settings), file.extension);
			const response = await this.getBackend().uploadObject(
				settings,
				this.getCredentials(),
				key,
				body,
				contentType,
			);
			return {
				key: response.remotePath,
				url: response.url,
				contentType,
				bytes: body.byteLength,
				requestId: response.requestId,
				localPath: file.path,
			};
		} catch (error) {
			if (error instanceof StorageOperationError) throw error;
			throw new StorageOperationError(normalizeS3Error(error));
		}
	}

	async renameFileToRemoteName(file: TFile, key: string): Promise<TFile> {
		return renameLocalFile(this.app, file, getObjectFilename(key));
	}
}

function getImageContentType(extension: string): string | undefined {
	return MIME_TYPES[extension.toLowerCase()];
}

function createObjectKey(prefix: string, extension: string): string {
	const now = new Date();
	const datePath = [now.getUTCFullYear(), now.getUTCMonth() + 1]
		.map((part) => String(part).padStart(2, '0'))
		.join('/');
	const cleanPrefix = trimSlashes(prefix);
	const filename = `${crypto.randomUUID()}.${extension.toLowerCase()}`;
	return `${cleanPrefix ? `${cleanPrefix}/` : ''}${datePath}/${filename}`;
}

function getRemotePathPrefix(settings: ImageUploadSettings): string {
	if (settings.provider === 'github') return settings.githubPathPrefix;
	if (settings.provider === 'gitlab') return settings.gitlabPathPrefix;
	return settings.objectKeyPrefix;
}

function getObjectFilename(key: string): string {
	const parts = key.split('/');
	return parts[parts.length - 1] ?? key;
}

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

function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}

function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function configurationError(message: string): StorageOperationError {
	return new StorageOperationError({ kind: 'configuration', message });
}
