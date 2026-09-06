import { Notice, Plugin } from 'obsidian';
import {
	formatErrorForNotice,
	logS3Diagnostic,
	logS3Error,
	normalizeS3Error,
	S3OperationError,
} from './errors';
import {
	ImageUploadSettingTab,
	loadImageUploadSettings,
	validateSettings,
} from './settings';
import { CredentialStorage } from './storage';
import { S3ClientService } from './s3-client';
import { ImageUploadSettings, NormalizedError, S3Credentials } from './types';

export default class ImageUploadPlugin extends Plugin {
	settings!: ImageUploadSettings;
	credentials!: S3Credentials;
	private credentialStorage!: CredentialStorage;
	private s3Client!: S3ClientService;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.credentialStorage = new CredentialStorage(this.app);
		this.credentials = this.credentialStorage.getCredentials();
		this.s3Client = new S3ClientService(() => this.credentials);

		this.addSettingTab(new ImageUploadSettingTab(this.app, this));
		this.addCommand({
			id: 'test-s3-connection',
			name: 'Test S3 connection',
			callback: () => this.testConnection(),
		});
		this.addCommand({
			id: 'test-s3-upload',
			name: 'Test S3 upload',
			callback: () => this.testUpload(),
		});
	}

	async loadSettings(): Promise<void> {
		const saved: unknown = await this.loadData();
		this.settings = loadImageUploadSettings(saved);
		if (JSON.stringify(saved) !== JSON.stringify(this.settings)) {
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async testConnection(): Promise<void> {
		logS3Diagnostic('test-connection-start', {
			endpoint: this.settings.endpoint,
			region: this.settings.region,
			bucket: this.settings.bucket,
		});
		const validationErrors = this.getValidationErrors();
		if (validationErrors.length > 0) {
			logS3Diagnostic('test-connection-validation-failed', { errors: validationErrors });
			new Notice(validationErrors.at(0) ?? 'S3 配置无效。');
			return;
		}
		if (!this.credentialStorage.hasCredentials()) {
			logS3Diagnostic('test-connection-credentials-missing', {});
			new Notice('请先配置 access key ID 和 secret access key。');
			return;
		}

		try {
			logS3Diagnostic('test-connection-request-start', {});
			await this.s3Client.testConnection(this.settings);
			logS3Diagnostic('test-connection-success', {});
			new Notice('S3 连接测试成功。');
		} catch (error) {
			const normalizedError = this.getNormalizedError(error);
			logS3Diagnostic('test-connection-caught', {
			errorName: error instanceof Error ? error.name : typeof error,
			errorMessage: error instanceof Error ? error.message : String(error),
		});
			logS3Error('test-connection', this.settings, normalizedError);
			new Notice(formatErrorForNotice(normalizedError));
		}
	}

	async testUpload(): Promise<void> {
		const validationErrors = this.getValidationErrors();
		if (validationErrors.length > 0) {
			new Notice(validationErrors.at(0) ?? 'S3 配置无效。');
			return;
		}
		if (!this.credentialStorage.hasCredentials()) {
			new Notice('请先配置 access key ID 和 secret access key。');
			return;
		}

		try {
			await this.s3Client.testUpload(this.settings);
			new Notice('S3 测试上传成功，临时对象已清理。');
		} catch (error) {
			const normalizedError = this.getNormalizedError(error);
			logS3Error('test-upload', this.settings, normalizedError);
			new Notice(formatErrorForNotice(normalizedError));
		}
	}

	updateCredential(key: keyof S3Credentials, value: string): void {
		this.credentials[key] = value;
		this.credentialStorage.saveCredentials(this.credentials);
	}

	hasCredentials(): boolean {
		return this.credentialStorage.hasCredentials();
	}

	clearCredentials(): void {
		this.credentialStorage.clearCredentials();
		this.credentials = this.credentialStorage.getCredentials();
	}

	private getValidationErrors(): string[] {
		return validateSettings(this.settings);
	}

	private getNormalizedError(error: unknown): NormalizedError {
		if (error instanceof S3OperationError) return error.normalized;
		if (isNormalizedErrorWrapper(error)) return error.normalized;
		return normalizeS3Error(error);
	}
}

function isNormalizedErrorWrapper(
	error: unknown,
): error is { normalized: NormalizedError } {
	if (typeof error !== 'object' || error === null) return false;
	const normalized = (error as { normalized?: unknown }).normalized;
	if (typeof normalized !== 'object' || normalized === null) return false;
	const message = (normalized as { message?: unknown }).message;
	const kind = (normalized as { kind?: unknown }).kind;
	return typeof message === 'string' && typeof kind === 'string';
}
