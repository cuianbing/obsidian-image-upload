import { App } from 'obsidian';
import { S3Credentials } from './types';

const ACCESS_KEY_ID = 's3-access-key-id';
const SECRET_ACCESS_KEY = 's3-secret-access-key';
const SESSION_TOKEN = 's3-session-token';

export class CredentialStorage {
	constructor(private readonly app: App) {}

	getCredentials(): S3Credentials {
		return {
			accessKeyId: this.app.secretStorage.getSecret(ACCESS_KEY_ID) ?? '',
			secretAccessKey: this.app.secretStorage.getSecret(SECRET_ACCESS_KEY) ?? '',
			sessionToken: this.app.secretStorage.getSecret(SESSION_TOKEN) ?? '',
		};
	}

	saveCredentials(credentials: S3Credentials): void {
		this.app.secretStorage.setSecret(ACCESS_KEY_ID, credentials.accessKeyId.trim());
		this.app.secretStorage.setSecret(
			SECRET_ACCESS_KEY,
			credentials.secretAccessKey.trim(),
		);
		this.app.secretStorage.setSecret(SESSION_TOKEN, credentials.sessionToken.trim());
	}

	clearCredentials(): void {
		this.app.secretStorage.setSecret(ACCESS_KEY_ID, '');
		this.app.secretStorage.setSecret(SECRET_ACCESS_KEY, '');
		this.app.secretStorage.setSecret(SESSION_TOKEN, '');
	}

	hasCredentials(): boolean {
		const credentials = this.getCredentials();
		return credentials.accessKeyId.length > 0 && credentials.secretAccessKey.length > 0;
	}
}
