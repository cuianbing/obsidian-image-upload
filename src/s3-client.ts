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

	/** 保存凭证读取器，避免 S3ClientService 直接依赖插件生命周期。
	 * @param getCredentials 获取当前 S3 凭证的延迟读取函数。
	 */
	constructor(
		private readonly getCredentials: () => {
			accessKeyId: string;
			secretAccessKey: string;
			sessionToken: string;
		},
	) {}

	/** 使用 HeadBucketCommand 验证 Endpoint、Bucket 和凭证的组合。
	 * @param settings 当前 S3 Endpoint、Bucket、Region 和请求策略。
	 * @returns 测试操作类型及服务端返回的请求 ID。
	 * @throws S3OperationError 当配置、网络或服务端请求失败时抛出。
	 */
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

	/** 上传固定测试内容并清理临时对象，验证写入和删除权限。
	 * @param settings 当前 S3 Endpoint、Bucket、Region 和对象前缀配置。
	 * @returns 测试操作类型及上传请求 ID。
	 * @throws S3OperationError 当上传或临时对象清理失败时抛出。
	 */
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

	/** 将图片二进制内容上传到指定的 S3 对象 key。
	 * @param settings 当前 S3 连接配置。
	 * @param key 要写入的对象 key。
	 * @param body 图片二进制内容。
	 * @param contentType 图片 MIME 类型。
	 * @returns 上传操作类型和服务端请求 ID。
	 * @throws S3OperationError 当 S3 上传失败时抛出。
	 */
	async uploadObject(
		settings: ImageUploadSettings,
		key: string,
		body: Uint8Array,
		contentType: string,
	): Promise<S3OperationResult> {
		const client = this.createClient(settings);
		try {
			const response = await client.send(
				new PutObjectCommand({
					Bucket: settings.bucket,
					Key: key,
					Body: body,
					ContentType: contentType,
				}),
			);
			return { operation: 'upload', requestId: response.$metadata.requestId };
		} catch (error) {
			throw new S3OperationError(normalizeS3Error(error));
		}
	}

	/** 按配置和凭证缓存 S3Client；配置或凭证变化时创建新客户端。
	 * @param settings 用于创建客户端的 S3 连接和重试配置。
	 * @returns 可执行 S3 命令的客户端实例。
	 */
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

/** 去除对象 key 首尾斜杠，避免生成双斜杠路径。
 * @param value 待处理的对象路径前缀。
 * @returns 去除首尾斜杠后的路径。
 */
function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, '');
}
