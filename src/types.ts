export interface ImageUploadSettings {
	schemaVersion: number;
	endpoint: string;
	region: string;
	bucket: string;
	publicUrlPrefix: string;
	objectKeyPrefix: string;
	maxFileSize: number;
	requestTimeout: number;
	retryCount: number;
	autoUploadOnPaste: boolean;
	deleteLocalAfterUpload: boolean;
	fallbackToLocalOnFailure: boolean;
	showUploadNotice: boolean;
	forcePathStyle: boolean;
}

export interface S3Credentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken: string;
}

export type S3Operation = 'connection' | 'test-upload';

export interface S3OperationResult {
	operation: S3Operation;
	requestId?: string;
}

export interface NormalizedError {
	kind: 'configuration' | 'authentication' | 'permission' | 'network' | 'server' | 'unknown';
	message: string;
	requestId?: string;
	debugMessage?: string;
	statusCode?: number;
	code?: string;
	stack?: string;
}
