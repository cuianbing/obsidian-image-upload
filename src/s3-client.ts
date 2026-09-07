import {
	DeleteObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { logS3Diagnostic, normalizeS3Error, S3OperationError } from './errors';
import { ObsidianRequestHandler } from './obsidian-request-handler';
import { StorageBackend } from './storage-backend';
import {
	ImageUploadSettings,
	StorageCredentials,
	StorageOperationResult,
	StorageUploadResult,
} from './types';

export class S3ClientService implements StorageBackend {
	readonly provider = 's3';
	private client: S3Client | null = null;
	private clientKey = '';

	async testConnection(settings: ImageUploadSettings, credentials: StorageCredentials): Promise<StorageOperationResult> {
		logS3Diagnostic('s3-client-create', {
			endpoint: settings.endpoint,
			region: settings.region,
			bucket: settings.bucket,
			forcePathStyle: settings.forcePathStyle,
		});
		const client = this.createClient(settings, credentials);
		try {
			const response = await client.send(new HeadBucketCommand({ Bucket: settings.bucket }));
			return { operation: 'connection', requestId: response.$metadata.requestId };
		} catch (error) {
			throw new S3OperationError(normalizeS3Error(error));
		}
	}

	async testUpload(settings: ImageUploadSettings, credentials: StorageCredentials): Promise<StorageOperationResult> {
		const client = this.createClient(settings, credentials);
		const key = `${trimSlashes(settings.objectKeyPrefix)}/.plugin-test/${crypto.randomUUID()}.txt`;
		try {
			const response = await client.send(new PutObjectCommand({
				Bucket: settings.bucket,
				Key: key,
				Body: new TextEncoder().encode('obsidian-image-upload-test'),
				ContentType: 'text/plain',
			}));
			try {
				await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
			} catch {
				throw new S3OperationError({ kind: 'permission', message: '测试上传成功，但临时测试对象清理失败。' });
			}
			return { operation: 'test-upload', requestId: response.$metadata.requestId };
		} catch (error) {
			if (error instanceof S3OperationError) throw error;
			throw new S3OperationError(normalizeS3Error(error));
		}
	}

	async uploadObject(
		settings: ImageUploadSettings,
		credentials: StorageCredentials,
		key: string,
		body: Uint8Array,
		contentType: string,
	): Promise<StorageUploadResult> {
		const client = this.createClient(settings, credentials);
		try {
			const response = await client.send(new PutObjectCommand({
				Bucket: settings.bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
			}));
			return {
				remotePath: key,
				url: createPublicUrl(settings.publicUrlPrefix, key),
				requestId: response.$metadata.requestId,
			};
		} catch (error) {
			throw new S3OperationError(normalizeS3Error(error));
		}
	}

	private createClient(settings: ImageUploadSettings, credentials: StorageCredentials): S3Client {
		const clientKey = JSON.stringify({ settings, credentials });
		if (this.client && this.clientKey === clientKey) return this.client;
		this.client = new S3Client({
			region: settings.region,
			endpoint: settings.endpoint,
			forcePathStyle: settings.forcePathStyle,
			maxAttempts: settings.retryCount + 1,
			requestHandler: new ObsidianRequestHandler(),
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
				sessionToken: credentials.sessionToken || undefined,
			},
		});
		this.clientKey = clientKey;
		return this.client;
	}
}

function createPublicUrl(publicUrlPrefix: string, key: string): string {
	const prefix = publicUrlPrefix.replace(/\/+$/, '');
	const encodedKey = key.split('/').map((part) => encodeURIComponent(part)).join('/');
	return `${prefix}/${encodedKey}`;
}

function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}
