import { requestUrl } from 'obsidian';
import { StorageOperationError } from './errors';
import { StorageBackend } from './storage-backend';
import { ImageUploadSettings, StorageCredentials, StorageOperationResult, StorageUploadResult } from './types';

export class GitLabStorageBackend implements StorageBackend {
	readonly provider = 'gitlab';

	async testConnection(settings: ImageUploadSettings, credentials: StorageCredentials): Promise<StorageOperationResult> {
		const host = normalizeHost(settings.gitlabHost);
		const project = required(settings.gitlabProject, 'GitLab project');
		const branch = required(settings.gitlabBranch, 'GitLab branch');
		await gitlabRequest(`${host}/api/v4/projects/${encodeURIComponent(project)}/repository/branches/${encodeURIComponent(branch)}`, credentials, 'GET');
		return { operation: 'connection' };
	}

	async testUpload(settings: ImageUploadSettings, credentials: StorageCredentials): Promise<StorageOperationResult> {
		await this.testConnection(settings, credentials);
		return { operation: 'test-upload' };
	}

	async uploadObject(
		settings: ImageUploadSettings,
		credentials: StorageCredentials,
		path: string,
		body: Uint8Array,
		_contentType: string,
	): Promise<StorageUploadResult> {
		const host = normalizeHost(settings.gitlabHost);
		const project = required(settings.gitlabProject, 'GitLab project');
		const branch = required(settings.gitlabBranch, 'GitLab branch');
		const filePath = path.replace(/^\/+|\/+$/g, '');
		await gitlabRequest(
			`${host}/api/v4/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(filePath)}`,
			credentials,
			'POST',
			JSON.stringify({
				branch,
				content: toBase64(body),
				encoding: 'base64',
				commit_message: settings.gitlabCommitMessage || 'Upload image from Obsidian',
			}),
		);
		return {
			remotePath: filePath,
			url: `${host}/${encodePath(project)}/-/raw/${encodeURIComponent(branch)}/${encodePath(filePath)}`,
		};
	}
}

async function gitlabRequest(
	url: string,
	credentials: StorageCredentials,
	method: 'GET' | 'POST',
	body?: string,
): Promise<void> {
	const token = required(credentials.token, 'GitLab token');
	const response = await requestUrl({
		url,
		method,
		headers: {
			'PRIVATE-TOKEN': token,
			Accept: 'application/json',
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		...(body ? { body } : {}),
		throw: false,
	});
	if (response.status < 200 || response.status >= 300) {
		throw new StorageOperationError({
			kind: response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : response.status >= 500 ? 'server' : 'unknown',
			message: gitlabMessage(response.status),
			statusCode: response.status,
		});
	}
}

function gitlabMessage(status: number): string {
	if (status === 401) return 'GitLab Token 无效。';
	if (status === 403) return 'GitLab 项目访问被拒绝或 API 已限流。';
	if (status === 404) return 'GitLab 项目或分支不存在。';
	if (status === 409) return 'GitLab 提交发生冲突，请稍后重试。';
	if (status === 413) return 'GitLab 文件过大。';
	return 'GitLab API 请求失败。';
}

function normalizeHost(value: string): string {
	const host = value.trim().replace(/\/+$/, '');
	if (!host) throw new StorageOperationError({ kind: 'configuration', message: '请填写 GitLab Host。' });
	return host;
}

function required(value: string, name: string): string {
	if (!value.trim()) throw new StorageOperationError({ kind: 'configuration', message: `请填写 ${name}。` });
	return value.trim();
}

function encodePath(path: string): string {
	return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
