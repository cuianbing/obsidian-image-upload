import {
	App,
	Editor,
	FuzzySuggestModal,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
} from 'obsidian';
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
import { ImageUploadService } from './upload-service';
import { findImageReferenceAtCursor, resolveImageFile } from './image-detector';
import { replaceImageReference } from './markdown-replacer';
import { ImageUploadResult, ImageUploadSettings, NormalizedError, S3Credentials } from './types';

export default class ImageUploadPlugin extends Plugin {
	settings!: ImageUploadSettings;
	credentials!: S3Credentials;
	private credentialStorage!: CredentialStorage;
	private s3Client!: S3ClientService;
	uploadService!: ImageUploadService;

	/** 加载配置、初始化凭证和 S3 服务，并注册设置页与测试命令。
	 * @returns 插件初始化完成后的 Promise。
	 */
	async onload(): Promise<void> {
		await this.loadSettings();
		this.credentialStorage = new CredentialStorage(this.app);
		this.credentials = this.credentialStorage.getCredentials();
		this.s3Client = new S3ClientService(() => this.credentials);
		this.uploadService = new ImageUploadService(this.app, this.s3Client, () => this.settings);

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
		this.addCommand({
			id: 'upload-current-image-to-s3',
			name: 'Upload current image to S3',
			editorCallback: (editor: Editor) => {
				void this.uploadCurrentImage(editor);
			},
		});
		this.addCommand({
			id: 'upload-image-file-to-s3',
			name: 'Upload image file to S3',
			editorCallback: (editor: Editor) => {
				new ImageFileSuggestModal(this.app, this, editor).open();
			},
		});
	}

	/** 读取并迁移插件配置；发现旧配置时立即持久化规范化结果。
	 * @returns 配置加载完成后的 Promise。
	 */
	async loadSettings(): Promise<void> {
		const saved: unknown = await this.loadData();
		this.settings = loadImageUploadSettings(saved);
		if (JSON.stringify(saved) !== JSON.stringify(this.settings)) {
			await this.saveSettings();
		}
	}

	/** 保存非敏感插件配置；敏感凭证由 CredentialStorage 单独保存。
	 * @returns 配置保存完成后的 Promise。
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 校验配置和凭证后，通过 HeadBucket 验证 S3 Bucket 的访问权限。
	 * @returns 测试完成后的 Promise。
	 */
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

	/** 上传并删除临时测试对象，验证当前凭证是否具备对象写入和删除权限。
	 * @returns 测试完成后的 Promise。
	 */
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

	/** 上传指定 Vault 图片，供后续编辑器命令和粘贴流程复用。
	 * @param file Vault 中待上传的图片文件。
	 * @returns 包含对象 key 和公开 URL 的上传结果。
	 */
	async uploadFile(file: TFile): Promise<ImageUploadResult> {
		return this.uploadService.uploadFile(file);
	}

	/** 上传光标所在的本地图片，并只替换当前 Markdown 图片引用。
	 * @param editor 当前 Markdown 编辑器。
	 * @returns 上传和替换完成后的 Promise；没有有效图片时直接结束。
	 */
	private async uploadCurrentImage(editor: Editor): Promise<void> {
		const reference = findImageReferenceAtCursor(editor);
		if (!reference) {
			new Notice('请将光标放在本地图片引用上。');
			return;
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sourcePath = view?.file?.path ?? '';
		const file = resolveImageFile(this.app, reference, sourcePath);
		if (!file) {
			new Notice('当前图片不是 vault 中的本地图片。');
			return;
		}

		try {
			const result = await this.uploadFile(file);
			replaceImageReference(editor, reference, result.url);
			const renamedFile = this.settings.renameLocalAfterUpload
				? await this.uploadService.renameFileToRemoteName(file, result.key)
				: file;
			if (this.settings.deleteLocalAfterUpload) {
				await this.app.fileManager.trashFile(renamedFile);
			}
			new Notice('图片已上传并替换为 S3 链接。');
		} catch (error) {
			const normalizedError = this.getNormalizedError(error);
			logS3Error('upload-current-image', this.settings, normalizedError);
			new Notice(formatErrorForNotice(normalizedError));
		}
	}

	/** 上传用户选中的 Vault 图片，并在当前光标位置插入标准 Markdown 图片。
	 * @param editor 当前 Markdown 编辑器。
	 * @param file 用户选择的 Vault 图片文件。
	 * @returns 上传、插入和后续文件处理完成后的 Promise。
	 */
	async uploadSelectedImage(editor: Editor, file: TFile): Promise<void> {
		try {
			const result = await this.uploadFile(file);
			editor.replaceSelection(`![${file.basename}](${result.url})`);
			const renamedFile = this.settings.renameLocalAfterUpload
				? await this.uploadService.renameFileToRemoteName(file, result.key)
				: file;
			if (this.settings.deleteLocalAfterUpload) {
				await this.app.fileManager.trashFile(renamedFile);
			}
			new Notice('图片已上传并插入 S3 链接。');
		} catch (error) {
			const normalizedError = this.getNormalizedError(error);
			logS3Error('upload-selected-image', this.settings, normalizedError);
			new Notice(formatErrorForNotice(normalizedError));
		}
	}
	/** 更新单项敏感凭证，并立即写入 Obsidian SecretStorage。
	 * @param key 要更新的凭证字段名。
	 * @param value 用户输入的新凭证值。
	 * @returns 无返回值；凭证写入由 SecretStorage 同步完成。
	 */
	updateCredential(key: keyof S3Credentials, value: string): void {
		this.credentials[key] = value;
		this.credentialStorage.saveCredentials(this.credentials);
	}

	/** 判断 Access Key ID 和 Secret Access Key 是否都已配置。
	 * @returns 必需凭证是否都非空。
	 */
	hasCredentials(): boolean {
		return this.credentialStorage.hasCredentials();
	}

	/** 清空 SecretStorage 中保存的所有 S3 凭证并刷新内存副本。
	 * @returns 无返回值。
	 */
	clearCredentials(): void {
		this.credentialStorage.clearCredentials();
		this.credentials = this.credentialStorage.getCredentials();
	}

	/** 返回当前配置的字段校验错误；空数组表示配置格式有效。
	 * @returns 当前配置的错误列表。
	 */
	private getValidationErrors(): string[] {
		return validateSettings(this.settings);
	}

	/** 将 SDK、包装异常和普通异常统一转换为可展示、可记录的错误结构。
	 * @param error 原始异常对象或插件包装后的异常。
	 * @returns 包含分类、用户文案和脱敏诊断字段的错误对象。
	 */
	private getNormalizedError(error: unknown): NormalizedError {
		if (error instanceof S3OperationError) return error.normalized;
		if (isNormalizedErrorWrapper(error)) return error.normalized;
		return normalizeS3Error(error);
	}
}

/** 提供 Vault 图片搜索选择，并在确认后启动上传。 */
class ImageFileSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly imageFiles: TFile[];

	constructor(
		app: App,
		private readonly plugin: ImageUploadPlugin,
		private readonly editor: Editor,
	) {
		super(app);
		this.imageFiles = app.vault.getFiles().filter((file) => isImageFile(file));
		this.setPlaceholder('选择要上传的图片');
	}

	/** @returns 当前 Vault 中可上传的图片文件。 */
	getItems(): TFile[] {
		return this.imageFiles;
	}

	/** @param file 要显示的 Vault 图片文件。
	 * @returns 用于搜索和展示的文件路径。
	 */
	getItemText(file: TFile): string {
		return file.path;
	}

	/** @param file 用户确认选择的图片文件。 */
	onChooseItem(file: TFile): void {
		void this.plugin.uploadSelectedImage(this.editor, file);
	}
}

/** 判断 Vault 文件是否为插件支持的图片格式。 */
function isImageFile(file: TFile): boolean {
	return ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']
		.includes(file.extension.toLowerCase());
}

/** 兼容打包环境中 instanceof 失效的情况，识别带 normalized 字段的异常。
 * @param error 待检查的未知异常值。
 * @returns 异常是否包含有效的 normalized 错误对象。
 */
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
