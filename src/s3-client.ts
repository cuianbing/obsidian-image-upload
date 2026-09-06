import {
	DeleteObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';
import { logS3Diagnostic, normalizeS3Error, S3OperationError } from './errors';
import { ObsidianRequestHandler } from './obsidian-request-handler';
import {
	ImageUploadSettings,
	S3OperationResult,
} from './types';

export class S3ClientService {
	private client: S3Client | null = null;
	private clientKey = '';

	constructor(
		private readonly getCredentials: () => {
			accessKeyId: string;
			secretAccessKey: string;
			sessionToken: string;
		},
	) {}

	async testConnection(settings: ImageUploadSettings): Promise<S3OperationResult> {
		logS3Diagnostic('s3-client-create', {
			endpoint: settings.endpoint,
			region: settings.region,
			bucket: settings.bucket,
			forcePathStyle: settings.forcePathStyle,
		});
		const client = this.createClient(settings);
		try {
			logS3Diagnostic('head-bucket-request', {});
			const response = await client.send(
				new HeadBucketCommand({ Bucket: settings.bucket }),
			);
			return {
				operation: 'connection',
				requestId: response.$metadata.requestId,
			};
		} catch (error) {
			throw new S3OperationError(normalizeS3Error(error));
		}
	}

	async testUpload(settings: ImageUploadSettings): Promise<S3OperationResult> {
		const client = this.createClient(settings);
		const key = `${trimSlashes(settings.objectKeyPrefix)}/.plugin-test/${crypto.randomUUID()}.txt`;
		try {
			const response = await client.send(
				new PutObjectCommand({
					Bucket: settings.bucket,
					Key: key,
					Body: new TextEncoder().encode('obsidian-image-upload-test'),
					ContentType: 'text/plain',
				}),
			);
			try {
				await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
			} catch {
				throw new S3OperationError({
					kind: 'permission',
					message: '测试上传成功，但临时测试对象清理失败。',
				});
			}
			return { operation: 'test-upload', requestId: response.$metadata.requestId };
		} catch (error) {
			if (error instanceof S3OperationError) {
				throw error;
			}
			throw new S3OperationError(normalizeS3Error(error));
		}
	}

	private createClient(settings: ImageUploadSettings): S3Client {
		const credentials = this.getCredentials();
		const clientKey = JSON.stringify({ settings, credentials });
		if (this.client && this.clientKey === clientKey) {
			return this.client;
		}
		this.client = new S3Client({
			region: settings.region,
			endpoint: settings.endpoint,
			forcePathStyle: settings.forcePathStyle,
			maxAttempts: settings.retryCount + 1,
			requestHandler: new ObsidianRequestHandler(),
			credentials,
		});
		this.clientKey = clientKey;
		return this.client;
	}
}

function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}
