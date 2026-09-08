import { requestUrl } from 'obsidian';
import { StorageOperationError } from './errors';
import { StorageBackend } from './storage-backend';
import { ImageUploadSettings, StorageCredentials, StorageOperationResult, StorageUploadResult } from './types';

export class GitHubStorageBackend implements StorageBackend {
	readonly provider = 'github';

	async testConnection(settings: ImageUploadSettings, credentials: StorageCredentials): Promise<StorageOperationResult> {
		const owner = required(settings.githubOwner, 'GitHub owner');
		const repository = required(settings.githubRepository, 'GitHub repository');
		const branch = required(settings.githubBranch, 'GitHub branch');
		await githubRequest(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}`, credentials, 'GET');
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
		const owner = required(settings.githubOwner, 'GitHub owner');
		const repository = required(settings.githubRepository, 'GitHub repository');
		const branch = required(settings.githubBranch, 'GitHub branch');
		const token = required(credentials.token, 'GitHub token');
		const filePath = path.replace(/^\/+|\/+$/g, '');
		const response = await githubRequest(
			`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodePath(filePath)}`,
			{ ...credentials, token },
			'PUT',
			JSON.stringify({
				message: settings.githubCommitMessage || 'Upload image from Obsidian',
				content: toBase64(body),
				branch,
			}),
		);
		const requestId = response.headers['x-github-request-id'];
		const url = createGithubImageUrl(settings, owner, repository, branch, filePath);
		return {
			remotePath: filePath,
			url,
			requestId,
		};
	}
}

async function githubRequest(
	url: string,
	credentials: StorageCredentials,
	method: 'GET' | 'PUT',
	body?: string,
): Promise<{ headers: Record<string, string> }> {
	const token = required(credentials.token, 'GitHub token');
	const response = await requestUrl({
		url,
		method,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${token}`,
			'X-GitHub-Api-Version': '2022-11-28',
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		...(body ? { body } : {}),
		throw: false,
	});
	if (response.status < 200 || response.status >= 300) {
		throw new StorageOperationError({
			kind: response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : response.status >= 500 ? 'server' : 'unknown',
			message: githubMessage(response.status),
			statusCode: response.status,
		});
	}
	return { headers: response.headers };
}

function githubMessage(status: number): string {
	if (status === 401) return 'GitHub Token 无效。';
	if (status === 403) return 'GitHub 仓库访问被拒绝或 API 已限流。';
	if (status === 404) return 'GitHub 仓库或分支不存在。';
	if (status === 409) return 'GitHub 提交发生冲突，请稍后重试。';
	if (status === 413) return 'GitHub 文件过大。';
	return 'GitHub API 请求失败。';
}

function required(value: string, name: string): string {
	if (!value.trim()) throw new StorageOperationError({ kind: 'configuration', message: `请填写 ${name}。` });
	return value.trim();
}

function encodePath(path: string): string {
	return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function createGithubImageUrl(
	settings: ImageUploadSettings,
	owner: string,
	repository: string,
	branch: string,
	filePath: string,
): string {
	const cdnDomain = settings.githubCdnDomain.trim().replace(/\/+$/, '');
	if (!cdnDomain) {
		return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodePath(branch)}/${encodePath(filePath)}`;
	}
	if (isJsDelivrDomain(cdnDomain)) {
		return `${cdnDomain}/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}@${encodeURIComponent(branch)}/${encodePath(filePath)}`;
	}
	return `${cdnDomain}/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodePath(branch)}/${encodePath(filePath)}`;
}

function isJsDelivrDomain(domain: string): boolean {
	try {
		return /(?:^|\.)jsdelivr\.net$/i.test(new URL(domain).hostname);
	} catch {
		return false;
	}
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
