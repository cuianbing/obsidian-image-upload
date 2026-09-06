import { App, Notice, Plugin as ObsidianPlugin, PluginSettingTab, Setting } from 'obsidian';
import { ImageUploadSettings } from './types';

interface SettingsPlugin {
	settings: ImageUploadSettings;
	credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
	updateCredential(key: 'accessKeyId' | 'secretAccessKey' | 'sessionToken', value: string): void;
	testConnection(): Promise<void>;
	testUpload(): Promise<void>;
	hasCredentials(): boolean;
	clearCredentials(): void;
	saveSettings(): Promise<void>;
}

export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: ImageUploadSettings = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	endpoint: '',
	region: 'us-east-1',
	bucket: '',
	publicUrlPrefix: '',
	objectKeyPrefix: 'obsidian/images',
	maxFileSize: 10 * 1024 * 1024,
	requestTimeout: 30_000,
	retryCount: 2,
	autoUploadOnPaste: false,
	deleteLocalAfterUpload: false,
	fallbackToLocalOnFailure: true,
	showUploadNotice: true,
	forcePathStyle: false,
};

export function loadImageUploadSettings(data: unknown): ImageUploadSettings {
	const saved = isRecord(data) ? data : {};
	const legacyValue = typeof saved.mySetting === 'string' ? saved.mySetting : undefined;
	return {
		...DEFAULT_SETTINGS,
		...saved,
		publicUrlPrefix:
			typeof saved.publicUrlPrefix === 'string'
				? saved.publicUrlPrefix
				: legacyValue ?? DEFAULT_SETTINGS.publicUrlPrefix,
		schemaVersion: CURRENT_SCHEMA_VERSION,
	};
}

export function validateSettings(settings: ImageUploadSettings): string[] {
	const errors: string[] = [];
	if (!settings.endpoint.trim()) errors.push('请填写 S3 Endpoint。');
	else {
		try {
			const endpoint = new URL(settings.endpoint);
			if (endpoint.protocol !== 'https:') errors.push('S3 Endpoint 必须使用 HTTPS。');
		} catch {
			errors.push('S3 Endpoint 不是有效的 URL。');
		}
	}
	if (!settings.region.trim()) errors.push('请填写 Region。');
	if (!settings.bucket.trim()) errors.push('请填写 Bucket。');
	if (settings.maxFileSize <= 0) errors.push('最大文件大小必须大于 0。');
	if (settings.requestTimeout < 1000) errors.push('请求超时时间不能小于 1000 毫秒。');
	if (settings.retryCount < 0 || settings.retryCount > 5) errors.push('重试次数必须在 0 到 5 之间。');
	return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export class ImageUploadSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: ObsidianPlugin & SettingsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('S3 图片上传').setHeading();
		containerEl.createEl('p', {
			text: '首版使用公开 URL。access key 和 secret key 仅保存在 Obsidian 的安全存储中。',
			cls: 'setting-item-description',
		});

		this.addTextSetting(containerEl, 'Endpoint', 'S3 服务地址，例如 https://s3.example.com', 'endpoint');
		this.addTextSetting(containerEl, 'Region', 'S3 区域，例如 us-east-1', 'region');
		this.addTextSetting(containerEl, 'Bucket', '用于存储图片的 Bucket', 'bucket');
		this.addTextSetting(containerEl, '公开 URL 前缀', '例如 https://cdn.example.com/images', 'publicUrlPrefix');
		this.addTextSetting(containerEl, '对象路径前缀', '例如 obsidian/images', 'objectKeyPrefix');

		new Setting(containerEl)
			.setName('Access key ID')
			.setDesc('保存在 Obsidian 安全存储中，不会写入插件配置文件。')
			.addText((text) =>
				text
					.setPlaceholder('输入 access key ID')
					.setValue(this.plugin.credentials.accessKeyId)
					.onChange(async (value) => this.plugin.updateCredential('accessKeyId', value)),
			);
		new Setting(containerEl)
			.setName('Secret access key')
			.setDesc('保存在 Obsidian 安全存储中，不会写入插件配置文件。')
			.addText((text) => {
				text
					.setPlaceholder('输入 secret access key')
					.setValue(this.plugin.credentials.secretAccessKey)
					.onChange(async (value) => this.plugin.updateCredential('secretAccessKey', value));
				text.inputEl.type = 'password';
			});
		new Setting(containerEl)
			.setName('Session token')
			.setDesc('使用临时凭证时填写，可留空。')
			.addText((text) =>
				text
					.setPlaceholder('可选')
					.setValue(this.plugin.credentials.sessionToken)
					.onChange(async (value) => this.plugin.updateCredential('sessionToken', value)),
			);

		this.addNumberSetting(containerEl, '最大文件大小（字节）', '单个文件允许上传的最大大小', 'maxFileSize');
		this.addNumberSetting(containerEl, '请求超时（毫秒）', '连接 S3 的最大等待时间', 'requestTimeout');
		this.addNumberSetting(containerEl, '重试次数', '网络失败时的重试次数，范围 0 到 5', 'retryCount');

		this.addToggleSetting(containerEl, '粘贴图片时自动上传', '关闭时保留 Obsidian 默认行为', 'autoUploadOnPaste');
		this.addToggleSetting(containerEl, '上传成功后删除本地文件', '默认关闭，仅在上传成功后删除本地图片', 'deleteLocalAfterUpload');
		this.addToggleSetting(containerEl, '上传失败时回退到本地保存', '推荐开启，确保上传失败时图片仍可使用', 'fallbackToLocalOnFailure');
		this.addToggleSetting(containerEl, '显示上传通知', '显示测试和上传结果通知', 'showUploadNotice');
		this.addToggleSetting(containerEl, '使用 Path-style Endpoint', '部分 S3-compatible 服务需要开启', 'forcePathStyle');

		new Setting(containerEl)
			.setName('连接测试')
			.setDesc('验证 endpoint、bucket 和凭证是否具备访问权限。')
			.addButton((button) =>
				button.setButtonText('测试连接').onClick(async () => {
					await this.plugin.testConnection();
				}),
			)
			.addButton((button) =>
				button.setButtonText('测试上传').onClick(async () => {
					await this.plugin.testUpload();
				}),
			);
		new Setting(containerEl)
			.setName('凭证状态')
			.setDesc(this.plugin.hasCredentials() ? 'Access Key 和 Secret Key 已配置。' : '尚未配置完整凭证。')
			.addButton((button) =>
				button.setButtonText('清除凭证').setWarning().onClick(async () => {
					this.plugin.clearCredentials();
					new Notice('S3 凭证已清除。');
					this.display();
				}),
			);
	}

	private addTextSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'endpoint' | 'region' | 'bucket' | 'publicUrlPrefix' | 'objectKeyPrefix',
	): void {
		new Setting(containerEl).setName(name).setDesc(desc).addText((text) =>
			text.setValue(this.plugin.settings[key]).onChange(async (value) => {
				this.plugin.settings[key] = value.trim();
				await this.plugin.saveSettings();
			}),
		);
	}

	private addNumberSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'maxFileSize' | 'requestTimeout' | 'retryCount',
	): void {
		new Setting(containerEl).setName(name).setDesc(desc).addText((text) =>
			text.setValue(String(this.plugin.settings[key])).onChange(async (value) => {
				const parsed = Number(value);
				if (Number.isFinite(parsed)) {
					this.plugin.settings[key] = parsed;
					await this.plugin.saveSettings();
				}
			}),
		);
	}

	private addToggleSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'autoUploadOnPaste' | 'deleteLocalAfterUpload' | 'fallbackToLocalOnFailure' | 'showUploadNotice' | 'forcePathStyle',
	): void {
		new Setting(containerEl).setName(name).setDesc(desc).addToggle((toggle) =>
			toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
				this.plugin.settings[key] = value;
				await this.plugin.saveSettings();
			}),
		);
	}
}
