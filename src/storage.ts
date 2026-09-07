import { App } from 'obsidian';
import { S3Credentials } from './types';

const ACCESS_KEY_ID = 's3-access-key-id';
const SECRET_ACCESS_KEY = 's3-secret-access-key';
const SESSION_TOKEN = 's3-session-token';
const GITHUB_TOKEN = 'github-token';
const GITLAB_TOKEN = 'gitlab-token';

export class CredentialStorage {
	/** 保存当前 Obsidian App，用于访问 SecretStorage。
	 * @param app 当前 Vault 对应的 Obsidian App 实例。
	 */
	constructor(private readonly app: App) {}

	/** 读取三类 S3 凭证；SecretStorage 未配置时返回空字符串。
	 * @returns Access Key ID、Secret Access Key 和 Session Token。
	 */
	getCredentials(): S3Credentials {
		return {
			accessKeyId: this.app.secretStorage.getSecret(ACCESS_KEY_ID) ?? '',
			secretAccessKey: this.app.secretStorage.getSecret(SECRET_ACCESS_KEY) ?? '',
			sessionToken: this.app.secretStorage.getSecret(SESSION_TOKEN) ?? '',
			token: '',
		};
	}

	getToken(provider: 'github' | 'gitlab'): string {
		return this.app.secretStorage.getSecret(provider === 'github' ? GITHUB_TOKEN : GITLAB_TOKEN) ?? '';
	}

	saveToken(provider: 'github' | 'gitlab', token: string): void {
		this.app.secretStorage.setSecret(provider === 'github' ? GITHUB_TOKEN : GITLAB_TOKEN, token.trim());
	}

	clearToken(provider: 'github' | 'gitlab'): void {
		this.saveToken(provider, '');
	}

	/** 写入或覆盖 S3 凭证，写入前去除首尾空白。
	 * @param credentials 要保存的 S3 凭证集合。
	 * @returns 无返回值。
	 */
	saveCredentials(credentials: S3Credentials): void {
		this.app.secretStorage.setSecret(ACCESS_KEY_ID, credentials.accessKeyId.trim());
		this.app.secretStorage.setSecret(
			SECRET_ACCESS_KEY,
			credentials.secretAccessKey.trim(),
		);
		this.app.secretStorage.setSecret(SESSION_TOKEN, credentials.sessionToken.trim());
	}

	/** 用空值清除插件使用的 S3 凭证。
	 * @returns 无返回值。
	 */
	clearCredentials(): void {
		this.app.secretStorage.setSecret(ACCESS_KEY_ID, '');
		this.app.secretStorage.setSecret(SECRET_ACCESS_KEY, '');
		this.app.secretStorage.setSecret(SESSION_TOKEN, '');
	}

	/** 仅判断必需的长期凭证是否存在，不验证其有效性。
	 * @returns Access Key ID 和 Secret Access Key 是否都非空。
	 */
	hasCredentials(): boolean {
		const credentials = this.getCredentials();
		return credentials.accessKeyId.length > 0 && credentials.secretAccessKey.length > 0;
	}
}
