import { GitHubStorageBackend } from './github-storage-backend';
import { GitLabStorageBackend } from './gitlab-storage-backend';
import { S3ClientService } from './s3-client';
import { StorageBackend } from './storage-backend';
import { StorageProvider } from './types';

export function createStorageBackend(provider: StorageProvider): StorageBackend {
	switch (provider) {
		case 'github':
			return new GitHubStorageBackend();
		case 'gitlab':
			return new GitLabStorageBackend();
		case 's3':
		default:
			return new S3ClientService();
	}
}
