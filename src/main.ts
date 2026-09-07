import {
	App,
	Editor,
	FuzzySuggestModal,
	MarkdownFileInfo,
	MarkdownView,
	Menu,
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
import { createStorageBackend } from './storage-backend-factory';
import { StorageBackend } from './storage-backend';
import { ImageUploadService } from './upload-service';
import { findImageReferenceAtCursor, findImageReferenceForFile, findImageReferences, resolveImageFile } from './image-detector';
import { replaceImageReference } from './markdown-replacer';
import { ImageUploadResult, ImageUploadSettings, NormalizedError, S3Credentials, StorageCredentials } from './types';

export default class ImageUploadPlugin extends Plugin {
	settings!: ImageUploadSettings;
	credentials!: S3Credentials;
	private credentialStorage!: CredentialStorage;
	private storageBackend!: StorageBackend;
	uploadService!: ImageUploadService;

	/** 加载配置、初始化存储服务，并注册设置页与测试命令。
	 * @returns 插件初始化完成后的 Promise。
	 */
	async onload(): Promise<void> {
		await this.loadSettings();
		this.credentialStorage = new CredentialStorage(this.app);
		this.credentials = this.credentialStorage.getCredentials();
		this.storageBackend = createStorageBackend(this.settings.provider);
		this.uploadService = new ImageUploadService(this.app, () => {
			this.storageBackend = createStorageBackend(this.settings.provider);
			return this.storageBackend;
		}, () => this.getStorageCredentials(), () => this.settings);

		this.addSettingTab(new ImageUploadSettingTab(this.app, this));
		this.addCommand({
			id: 'test-s3-connection',
			name: 'Test storage connection',
			callback: () => this.testConnection(),
		});
		this.addCommand({
			id: 'test-s3-upload',
			name: 'Test storage upload',
			callback: () => this.testUpload(),
		});
		this.addCommand({
			id: 'upload-current-image-to-s3',
			name: 'Upload current image',
			editorCallback: (editor: Editor) => {
				void this.uploadCurrentImage(editor);
			},
		});
		this.registerEvent(
			this.app.workspace.on('editor-paste', (event, editor, info) => {
				if (event.defaultPrevented || !this.settings.autoUploadOnPaste) return;
				if (!getPastedImage(event)) return;
				event.preventDefault();
				void this.handleImagePaste(event, editor, info);
			}),
		);
		this.addCommand({
			id: 'upload-image-file-to-s3',
			name: 'Upload image file',
			editorCallback: (editor: Editor) => {
				new ImageFileSuggestModal(this.app, this, editor).open();
			},
		});
		this.addCommand({
			id: 'upload-document-images-to-s3',
			name: 'Upload all document images',
			editorCallback: (editor: Editor) => {
				void this.uploadDocumentImages(editor);
			},
		});
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor) => {
				menu.addItem((item) => {
					item
						.setTitle('图片上传')
						.setIcon('image')
						.onClick((event) => {
							this.showImageUploadSubmenu(event, editor);
						});
				});
			}),
		);
	}

	/** 在编辑器右键菜单中显示“图片上传”的二级功能菜单。
	 * @param event 点击一级菜单时的鼠标或键盘事件。
	 * @param editor 当前 Markdown 编辑器。
	 * @param info 当前 Markdown 文件信息。
	 * @returns 无返回值；二级菜单通过 Obsidian Menu 显示。
	 */
	private showImageUploadSubmenu(
		event: MouseEvent | KeyboardEvent,
		editor: Editor,
	): void {
		const submenu = new Menu();
		submenu.addItem((item) => {
			item.setTitle('上传当前图片').setIcon('upload').onClick(() => {
				void this.uploadCurrentImage(editor);
			});
		});
		submenu.addItem((item) => {
			item.setTitle('选择图片上传').setIcon('file-image').onClick(() => {
				new ImageFileSuggestModal(this.app, this, editor).open();
			});
		});
		submenu.addItem((item) => {
			item.setTitle('上传当前文档的所有图片').setIcon('images').onClick(() => {
				void this.uploadDocumentImages(editor);
			});
		});

		const position = getSubmenuPosition(event);
		submenu.showAtPosition(position);
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
			new Notice(validationErrors[0] ?? 'S3 配置无效。');
			return;
		}
		if (!this.hasStorageCredentials()) {
			logS3Diagnostic('test-connection-credentials-missing', {});
			new Notice(this.settings.provider === 's3' ? '请先配置 access key ID 和 secret access key。' : '请先配置 Git provider token。');
			return;
		}

		try {
			logS3Diagnostic('test-connection-request-start', {});
			await this.getStorageBackend().testConnection(this.settings, this.getStorageCredentials());
			logS3Diagnostic('test-connection-success', {});
			new Notice(`${this.getProviderName()} 连接测试成功。`);
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
			new Notice(validationErrors[0] ?? 'S3 配置无效。');
			return;
		}
		if (!this.hasStorageCredentials()) {
			new Notice(this.settings.provider === 's3' ? '请先配置 access key ID 和 secret access key。' : '请先配置 Git provider token。');
			return;
		}

		try {
			await this.getStorageBackend().testUpload(this.settings, this.getStorageCredentials());
			new Notice(`${this.getProviderName()} 测试成功。`);
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

	private getStorageBackend(): StorageBackend {
		if (this.storageBackend.provider !== this.settings.provider) {
			this.storageBackend = createStorageBackend(this.settings.provider);
		}
		return this.storageBackend;
	}

	private getProviderName(): string {
		if (this.settings.provider === 'github') return 'GitHub';
		if (this.settings.provider === 'gitlab') return 'GitLab';
		return 'S3';
	}

	private getStorageCredentials(): StorageCredentials {
		return {
			...this.credentials,
			token: this.settings.provider === 's3'
				? ''
				: this.credentialStorage.getToken(this.settings.provider),
		};
	}

	private hasStorageCredentials(): boolean {
		return this.settings.provider === 's3'
			? this.credentialStorage.hasCredentials()
			: this.credentialStorage.getToken(this.settings.provider).length > 0;
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
			const renamedFile = this.settings.renameLocalAfterUpload
				? await this.uploadService.renameFileToRemoteName(file, result.key)
				: file;
			const currentReference = this.settings.renameLocalAfterUpload
				? findImageReferenceForFile(this.app, editor, sourcePath, renamedFile, reference.line, reference.target) ?? reference
				: reference;
			replaceImageReference(editor, currentReference, result.url);
			if (this.settings.deleteLocalAfterUpload) {
				await this.app.fileManager.trashFile(renamedFile);
			}
			new Notice(`图片已上传并替换为 ${this.getProviderName()} 链接。`);
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
			const renamedFile = this.settings.renameLocalAfterUpload
				? await this.uploadService.renameFileToRemoteName(file, result.key)
				: file;
			if (this.settings.deleteLocalAfterUpload) {
				await this.app.fileManager.trashFile(renamedFile);
			}
			editor.replaceSelection(`![${file.basename}](${result.url})`);
			new Notice('图片已上传并插入Markdown链接。');
		} catch (error) {
			const normalizedError = this.getNormalizedError(error);
			logS3Error('upload-selected-image', this.settings, normalizedError);
			new Notice(formatErrorForNotice(normalizedError));
		}
	}

	/** 上传当前文档中的全部本地图片，并动态更新上传进度提示。
	 * @param editor 当前 Markdown 编辑器。
	 * @returns 批量上传和替换完成后的 Promise。
	 */
	private async uploadDocumentImages(editor: Editor): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sourcePath = view?.file?.path ?? '';
		const references = findImageReferences(editor)
			.map((reference) => ({
				reference,
				file: resolveImageFile(this.app, reference, sourcePath),
			}))
			.filter((item): item is { reference: typeof item.reference; file: TFile } => item.file !== null)
			.sort((left, right) => right.reference.line - left.reference.line || right.reference.startCh - left.reference.startCh);
		if (references.length === 0) {
			new Notice('当前文档没有可上传的本地图片。');
			return;
		}

		const progressNotice = new Notice(`正在准备上传图片 0/${references.length}...`, 0);
		const results = new Map<string, ImageUploadResult>();
		const failureReasons = new Map<string, string>();
		let completed = 0;
		let failed = 0;
		for (const { file } of references) {
			try {
				let result = results.get(file.path);
				if (!result) {
					result = await this.uploadFile(file);
					results.set(file.path, result);
				}
				completed += 1;
				progressNotice.setMessage(`正在上传图片 ${completed + failed}/${references.length}...`);
			} catch (error) {
				failed += 1;
				const normalizedError = this.getNormalizedError(error);
				logS3Error('upload-document-images', this.settings, normalizedError);
				failureReasons.set(file.path, formatErrorForNotice(normalizedError));
				progressNotice.setMessage(`上传图片 ${completed + failed}/${references.length}，失败 ${failed} 张...`);
			}
		}

		const filesByPath = new Map<string, { file: TFile; result: ImageUploadResult }>();
		for (const [originalPath, result] of results) {
				const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
				if (!(originalFile instanceof TFile)) continue;
				const file = this.settings.renameLocalAfterUpload
					? await this.uploadService.renameFileToRemoteName(originalFile, result.key)
					: originalFile;
			filesByPath.set(file.path, { file, result });
		}
		const referencesToReplace = findImageReferences(editor)
			.map((reference) => ({
				reference,
				file: resolveImageFile(this.app, reference, sourcePath),
			}))
			.map((item) => ({
				...item,
				uploaded: item.file ? filesByPath.get(item.file.path) : undefined,
			}))
			.filter((item): item is typeof item & { uploaded: { file: TFile; result: ImageUploadResult } } => item.uploaded !== undefined)
			.sort((left, right) => right.reference.line - left.reference.line || right.reference.startCh - left.reference.startCh);
		for (const { reference, uploaded } of referencesToReplace) {
			replaceImageReference(editor, reference, uploaded.result.url);
		}
		if (this.settings.deleteLocalAfterUpload) {
			for (const { file } of filesByPath.values()) {
				await this.app.fileManager.trashFile(file);
			}
		}
		progressNotice.setMessage(failed === 0
			? `图片上传完成：${completed} 张。`
			: `图片上传完成：成功 ${completed} 张，失败 ${failed} 张。`);
		if (failureReasons.size > 0) {
			const details = [...failureReasons.entries()]
				.map(([path, reason]) => `${path}: ${reason}`)
				.join('\n');
			new Notice(`失败图片及原因：\n${details}`, 10000);
		}
		window.setTimeout(() => progressNotice.hide(), 4000);
	}

	/** 处理开启自动上传时的图片粘贴事件，失败时按配置回退到本地文件。
	 * @param event Obsidian 编辑器派发的粘贴事件。
	 * @param editor 接收粘贴内容的 Markdown 编辑器。
	 * @param info 当前 Markdown 文件信息，用于确定本地文件目录。
	 * @returns 粘贴处理完成后的 Promise。
	 */
	private async handleImagePaste(
		event: ClipboardEvent,
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo,
	): Promise<void> {
		const imageFile = getPastedImage(event);
		if (!imageFile) return;

		const localFile = await this.savePastedImage(imageFile, info);
		if (!localFile) return;
		const uploadNotice = new Notice('正在上传粘贴的图片...', 0);
		try {
			const result = await this.uploadFile(localFile);
			const renamedFile = this.settings.renameLocalAfterUpload
				? await this.uploadService.renameFileToRemoteName(localFile, result.key)
				: localFile;
			if (this.settings.deleteLocalAfterUpload) await this.app.fileManager.trashFile(renamedFile);
			editor.replaceSelection(`![${localFile.basename}](${result.url})`);
			uploadNotice.setMessage('粘贴图片已上传并插入Markdown链接。');
			window.setTimeout(() => uploadNotice.hide(), 2000);
		} catch (error) {
			const normalizedError = this.getNormalizedError(error);
			logS3Error('upload-pasted-image', this.settings, normalizedError);
			if (this.settings.fallbackToLocalOnFailure) {
				editor.replaceSelection(`![${localFile.basename}](${localFile.path})`);
				uploadNotice.setMessage(`上传失败，已保留本地图片：${formatErrorForNotice(normalizedError)}`);
			} else {
				await this.app.fileManager.trashFile(localFile);
				uploadNotice.setMessage(formatErrorForNotice(normalizedError));
			}
			window.setTimeout(() => uploadNotice.hide(), 2000);
		}
	}

	/** 将粘贴的图片保存到当前文档所在目录，并返回 Vault 文件对象。
	 * @param image 粘贴板中的图片文件。
	 * @param info 当前 Markdown 文件信息。
	 * @returns 新建的 Vault 图片文件；创建失败时返回 null。
	 */
	private async savePastedImage(
		image: File,
		info: MarkdownView | MarkdownFileInfo,
	): Promise<TFile | null> {
		try {
			const sourcePath = info.file?.path ?? '';
			const extension = image.type.split('/')[1] || 'png';
			const filename = `pasted-${Date.now()}.${extension}`;
			const parent = this.app.fileManager.getNewFileParent(sourcePath, filename);
			const path = parent.path ? `${parent.path}/${filename}` : filename;
			const buffer = await image.arrayBuffer();
			return await this.app.vault.createBinary(path, buffer);
		} catch (error) {
			const normalizedError = this.getNormalizedError(error);
			new Notice(`无法保存粘贴图片：${formatErrorForNotice(normalizedError)}`);
			return null;
		}
	}
	/** 更新单项敏感凭证，并立即写入 Obsidian SecretStorage。
	 * @param key 要更新的凭证字段名。
	 * @param value 用户输入的新凭证值。
	 * @returns 无返回值；凭证写入由 SecretStorage 同步完成。
	 */
	updateCredential(key: keyof S3Credentials, value: string): void {
		if (key === 'token') return;
		this.credentials[key] = value;
		this.credentialStorage.saveCredentials(this.credentials);
	}

	updateToken(value: string): void {
		if (this.settings.provider === 's3') return;
		this.credentialStorage.saveToken(this.settings.provider, value);
	}

	getToken(): string {
		return this.settings.provider === 's3' ? '' : this.credentialStorage.getToken(this.settings.provider);
	}

	/** 判断 Access Key ID 和 Secret Access Key 是否都已配置。
	 * @returns 必需凭证是否都非空。
	 */
	hasCredentials(): boolean {
		return this.hasStorageCredentials();
	}

	/** 清空 SecretStorage 中保存的所有 S3 凭证并刷新内存副本。
	 * @returns 无返回值。
	 */
	clearCredentials(): void {
		if (this.settings.provider === 's3') {
			this.credentialStorage.clearCredentials();
			this.credentials = this.credentialStorage.getCredentials();
		} else {
			this.credentialStorage.clearToken(this.settings.provider);
		}
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

/** 计算二级菜单显示位置；键盘触发时使用一级菜单项的位置。 */
function getSubmenuPosition(event: MouseEvent | KeyboardEvent): { x: number; y: number } {
	if (event instanceof MouseEvent) {
		return { x: event.clientX, y: event.clientY };
	}
	const target = event.target;
	if (target instanceof HTMLElement) {
		const rect = target.getBoundingClientRect();
		return { x: rect.right, y: rect.top };
	}
	return { x: 0, y: 0 };
}

/** 从粘贴事件中提取第一个图片文件，非图片粘贴返回 null。 */
function getPastedImage(event: ClipboardEvent): File | null {
	const files = Array.from(event.clipboardData?.files ?? []);
	return files.find((file) => file.type.startsWith('image/')) ?? null;
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
