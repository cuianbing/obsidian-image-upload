import { ImageUploadSettings, StorageCredentials, StorageOperationResult, StorageUploadResult } from './types';

export interface StorageBackend {
	readonly provider: string;
	testConnection(settings: ImageUploadSettings, credentials: StorageCredentials): Promise<StorageOperationResult>;
	testUpload(settings: ImageUploadSettings, credentials: StorageCredentials): Promise<StorageOperationResult>;
	uploadObject(
		settings: ImageUploadSettings,
		credentials: StorageCredentials,
		path: string,
		body: Uint8Array,
		contentType: string,
	): Promise<StorageUploadResult>;
}