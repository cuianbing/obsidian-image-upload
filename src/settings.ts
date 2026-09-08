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
	updateToken(value: string): void;
	getToken(): string;
	saveSettings(): Promise<void>;
}

export const CURRENT_SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: ImageUploadSettings = {
	schemaVersion: CURRENT_SCHEMA_VERSION,
	provider: 's3',
	endpoint: '',
	region: 'us-east-1',
	bucket: '',
	publicUrlPrefix: '',
	objectKeyPrefix: 'obsidian/images',
	maxFileSize: 10 * 1024 * 1024,
	requestTimeout: 30_000,
	retryCount: 2,
	autoUploadOnPaste: false,
	renameLocalAfterUpload: true,
	deleteLocalAfterUpload: false,
	fallbackToLocalOnFailure: true,
	showUploadNotice: true,
	forcePathStyle: false,
	githubOwner: '',
	githubRepository: '',
	githubBranch: 'main',
	githubPathPrefix: 'obsidian/images',
	githubCommitMessage: 'Upload image from Obsidian',
	githubCdnDomain: '',
	gitlabHost: 'https://gitlab.com',
	gitlabProject: '',
	gitlabBranch: 'main',
	gitlabPathPrefix: 'obsidian/images',
	gitlabCommitMessage: 'Upload image from Obsidian',
};

/** 将持久化数据合并到默认配置，并统一设置 schema 版本。
 * @param data loadData() 返回的未知持久化内容。
 * @returns 补全默认值并完成迁移后的配置。
 */
export function loadImageUploadSettings(data: unknown): ImageUploadSettings {
	const saved = isRecord(data) ? data : {};
	const legacyValue = typeof saved.mySetting === 'string' ? saved.mySetting : undefined;
	const provider = saved.provider === 'github' || saved.provider === 'gitlab' ? saved.provider : 's3';
	return {
		...DEFAULT_SETTINGS,
		...saved,
		provider,
		publicUrlPrefix:
			typeof saved.publicUrlPrefix === 'string'
				? saved.publicUrlPrefix
				: legacyValue ?? DEFAULT_SETTINGS.publicUrlPrefix,
		schemaVersion: CURRENT_SCHEMA_VERSION,
	};
}

/** 校验 Endpoint、Bucket、超时和重试等字段，返回面向用户的错误文案。
 * @param settings 待校验的插件配置。
 * @returns 面向用户的校验错误列表；空数组表示校验通过。
 */
export function validateSettings(settings: ImageUploadSettings): string[] {
	const errors: string[] = [];
	if (settings.provider === 'github') {
		if (!settings.githubOwner.trim()) errors.push('请填写 GitHub Owner。');
		if (!settings.githubRepository.trim()) errors.push('请填写 GitHub Repository。');
		if (!settings.githubBranch.trim()) errors.push('请填写 GitHub 分支。');
		if (settings.githubCdnDomain.trim()) {
			try {
				if (new URL(settings.githubCdnDomain).protocol !== 'https:') errors.push('GitHub CDN 域名必须使用 HTTPS。');
			} catch {
				errors.push('GitHub CDN 域名不是有效的 URL。');
			}
		}
	} else if (settings.provider === 'gitlab') {
		if (!settings.gitlabHost.trim()) errors.push('请填写 GitLab Host。');
		if (!settings.gitlabProject.trim()) errors.push('请填写 GitLab Project。');
		if (!settings.gitlabBranch.trim()) errors.push('请填写 GitLab 分支。');
	}
	if (settings.provider !== 's3') {
		if (settings.maxFileSize > 25 * 1024 * 1024) errors.push('GitHub/GitLab 图片大小不能超过 25 MB。');
		if (settings.provider === 'github' && !settings.githubPathPrefix.trim()) errors.push('请填写 GitHub 图片路径前缀。');
		if (settings.provider === 'gitlab' && !settings.gitlabPathPrefix.trim()) errors.push('请填写 GitLab 图片路径前缀。');
	}
	if (settings.provider === 's3') {
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
	}
	if (settings.maxFileSize <= 0) errors.push('最大文件大小必须大于 0。');
	if (settings.requestTimeout < 1000) errors.push('请求超时时间不能小于 1000 毫秒。');
	if (settings.retryCount < 0 || settings.retryCount > 5) errors.push('重试次数必须在 0 到 5 之间。');
	return errors;
}

/** 判断持久化配置是否为可展开的对象。
 * @param value 待判断的未知值。
 * @returns 值是否为非 null 对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export class ImageUploadSettingTab extends PluginSettingTab {
	/** 保存设置页所需的插件能力接口。
	 * @param app 当前 Obsidian App 实例。
	 * @param plugin 提供配置、凭证和测试操作的插件实例。
	 */
	constructor(app: App, private readonly plugin: ObsidianPlugin & SettingsPlugin) {
		super(app, plugin);
	}

	/** 为 Obsidian 1.13+ 提供可搜索的声明式设置，同时保留 display() 兼容旧版本。 */
	getSettingDefinitions() {
		return [
			{ name: '存储位置', desc: '选择图片的远程存储位置。GitHub 和 GitLab 首版仅支持公开仓库或项目。', control: { type: 'dropdown', key: 'provider', options: { s3: 'S3-compatible', github: 'GitHub', gitlab: 'GitLab' } } },
			{ name: 'Endpoint', desc: 'S3 服务地址，例如 https://s3.example.com', visible: () => this.plugin.settings.provider === 's3', control: { type: 'text', key: 'endpoint' } },
			{ name: 'Region', desc: 'S3 区域，例如 us-east-1', visible: () => this.plugin.settings.provider === 's3', control: { type: 'text', key: 'region' } },
			{ name: 'Bucket', desc: '用于存储图片的 Bucket', visible: () => this.plugin.settings.provider === 's3', control: { type: 'text', key: 'bucket' } },
			{ name: '公开 URL 前缀', desc: '例如 https://cdn.example.com/images', visible: () => this.plugin.settings.provider === 's3', control: { type: 'text', key: 'publicUrlPrefix' } },
			{ name: '对象路径前缀', desc: '例如 obsidian/images', visible: () => this.plugin.settings.provider === 's3', control: { type: 'text', key: 'objectKeyPrefix' } },
			{
				name: 'Access key ID',
				desc: '保存在 Obsidian 安全存储中，不会写入插件配置文件。',
				visible: () => this.plugin.settings.provider === 's3',
				render: (setting: Setting) => setting.addText((text) =>
					text.setValue(this.plugin.credentials.accessKeyId).onChange(async (value) => {
						this.plugin.updateCredential('accessKeyId', value);
					}),
				),
			},
			{
				name: 'Secret access key',
				desc: '保存在 Obsidian 安全存储中，不会写入插件配置文件。',
				visible: () => this.plugin.settings.provider === 's3',
				render: (setting: Setting) => setting.addText((text) => {
					text.setValue(this.plugin.credentials.secretAccessKey).onChange(async (value) => {
						this.plugin.updateCredential('secretAccessKey', value);
					});
					text.inputEl.type = 'password';
				}),
			},
			{
				name: 'Session token',
				desc: '使用临时凭证时填写，可留空。',
				visible: () => this.plugin.settings.provider === 's3',
				render: (setting: Setting) => setting.addText((text) =>
					text.setValue(this.plugin.credentials.sessionToken).onChange(async (value) => {
						this.plugin.updateCredential('sessionToken', value);
					}),
				),
			},
			{ name: '最大文件大小（字节）', desc: '单个文件允许上传的最大大小', control: { type: 'number', key: 'maxFileSize', min: 1 } },
			{ name: '请求超时（毫秒）', desc: '连接 S3 的最大等待时间', visible: () => this.plugin.settings.provider === 's3', control: { type: 'number', key: 'requestTimeout', min: 1000 } },
			{ name: '重试次数', desc: '网络失败时的重试次数，范围 0 到 5', visible: () => this.plugin.settings.provider === 's3', control: { type: 'number', key: 'retryCount', min: 0, max: 5 } },
			{ name: '粘贴图片时自动上传', desc: '关闭时保留 Obsidian 默认行为', control: { type: 'toggle', key: 'autoUploadOnPaste' } },
			{ name: '上传成功后重命名本地文件', desc: '将本地文件名改为远程 UUID 文件名；关闭后保留原文件名', control: { type: 'toggle', key: 'renameLocalAfterUpload' } },
			{ name: '上传成功后删除本地文件', desc: '默认关闭，仅在上传成功后删除本地图片', control: { type: 'toggle', key: 'deleteLocalAfterUpload' } },
			{ name: '上传失败时回退到本地保存', desc: '推荐开启，确保上传失败时图片仍可使用', control: { type: 'toggle', key: 'fallbackToLocalOnFailure' } },
			{ name: '显示上传通知', desc: '显示测试和上传结果通知', control: { type: 'toggle', key: 'showUploadNotice' } },
			{ name: '使用 Path-style Endpoint', desc: '部分 S3-compatible 服务需要开启', visible: () => this.plugin.settings.provider === 's3', control: { type: 'toggle', key: 'forcePathStyle' } },
			{ name: 'GitHub Owner', desc: 'GitHub 用户名或组织名', visible: () => this.plugin.settings.provider === 'github', control: { type: 'text', key: 'githubOwner' } },
			{ name: 'GitHub Repository', desc: '公开 GitHub 仓库名', visible: () => this.plugin.settings.provider === 'github', control: { type: 'text', key: 'githubRepository' } },
			{ name: 'GitHub Branch', desc: '上传目标分支', visible: () => this.plugin.settings.provider === 'github', control: { type: 'text', key: 'githubBranch' } },
			{ name: 'GitHub Path Prefix', desc: '仓库内的图片目录', visible: () => this.plugin.settings.provider === 'github', control: { type: 'text', key: 'githubPathPrefix' } },
			{ name: 'GitHub CDN Domain', desc: '可选，例如 https://cdn.jsdelivr.net；留空使用 GitHub Raw 地址', visible: () => this.plugin.settings.provider === 'github', control: { type: 'text', key: 'githubCdnDomain' } },
			{ name: 'GitLab Host', desc: '默认 https://gitlab.com', visible: () => this.plugin.settings.provider === 'gitlab', control: { type: 'text', key: 'gitlabHost' } },
			{ name: 'GitLab Project', desc: 'Project ID 或 namespace/project', visible: () => this.plugin.settings.provider === 'gitlab', control: { type: 'text', key: 'gitlabProject' } },
			{ name: 'GitLab Branch', desc: '上传目标分支', visible: () => this.plugin.settings.provider === 'gitlab', control: { type: 'text', key: 'gitlabBranch' } },
			{ name: 'GitLab Path Prefix', desc: '项目内的图片目录', visible: () => this.plugin.settings.provider === 'gitlab', control: { type: 'text', key: 'gitlabPathPrefix' } },
			{
				name: 'Git provider token',
				desc: 'Token 仅保存在 Obsidian 安全存储中；公开仓库不会将 Token 写入图片 URL。',
				visible: () => this.plugin.settings.provider !== 's3',
				render: (setting: Setting) => setting.addText((text) => {
					text.setValue(this.plugin.getToken());
					text.inputEl.type = 'password';
					text.onChange(async (value) => this.plugin.updateToken(value));
				}),
			},
			{
				name: '连接测试',
				desc: '验证 endpoint、bucket 和凭证是否具备访问权限。',
				render: (setting: Setting) => {
					setting
						.addButton((button) => button.setButtonText('测试连接').onClick(async () => this.plugin.testConnection()))
						.addButton((button) => button.setButtonText('测试上传').onClick(async () => this.plugin.testUpload()));
				},
			},
			{
				name: '凭证状态',
				desc: this.plugin.hasCredentials() ? 'Access Key 和 Secret Key 已配置。' : '尚未配置完整凭证。',
				action: () => {
					this.plugin.clearCredentials();
					new Notice('S3 凭证已清除。');
					this.refreshDefinitions();
				},
			},
		];
	}

	/** 在新旧 Obsidian API 中刷新设置页。 */
	private refreshDefinitions(): void {
		const tab = this as PluginSettingTab & { update?: () => void };
		if (typeof tab.update === 'function') {
			tab.update();
			return;
		}
		this.display();
	}

	/** 创建全部 S3 配置、凭证、策略开关和测试操作控件。
	 * @returns 无返回值；控件直接挂载到设置页容器。
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('图片上传').setHeading();
		new Setting(containerEl)
			.setName('存储位置')
			.setDesc('GitHub 和 GitLab 首版仅支持公开仓库或项目。')
			.addDropdown((dropdown) => dropdown
				.addOption('s3', 'S3-compatible')
				.addOption('github', 'GitHub')
				.addOption('gitlab', 'GitLab')
				.setValue(this.plugin.settings.provider)
				.onChange(async (value) => {
					if (value !== 's3' && value !== 'github' && value !== 'gitlab') return;
					this.plugin.settings.provider = value;
					await this.plugin.saveSettings();
					this.display();
				}));
		containerEl.createEl('p', {
			text: '首版使用公开 URL。access key 和 secret key 仅保存在 Obsidian 的安全存储中。',
			cls: 'setting-item-description',
		});

		if (this.plugin.settings.provider === 's3') {
		this.addTextSetting(containerEl, 'Endpoint', 'S3 服务地址，例如 https://s3.example.com', 'endpoint');
		this.addTextSetting(containerEl, 'Region', 'S3 区域，例如 us-east-1', 'region');
		this.addTextSetting(containerEl, 'Bucket', '用于存储图片的 Bucket', 'bucket');
		this.addTextSetting(containerEl, '公开 URL 前缀', '例如 https://cdn.example.com/images', 'publicUrlPrefix');
		this.addTextSetting(containerEl, '对象路径前缀', '例如 obsidian/images', 'objectKeyPrefix');
		} else if (this.plugin.settings.provider === 'github') {
			this.addTextSetting(containerEl, 'GitHub Owner', 'GitHub 用户名或组织名', 'githubOwner');
			this.addTextSetting(containerEl, 'GitHub Repository', '公开 GitHub 仓库名', 'githubRepository');
			this.addTextSetting(containerEl, 'GitHub Branch', '上传目标分支', 'githubBranch');
			this.addTextSetting(containerEl, 'GitHub Path Prefix', '仓库内的图片目录', 'githubPathPrefix');
			this.addTextSetting(containerEl, 'GitHub CDN Domain', '可选，例如 https://cdn.jsdelivr.net；留空使用 GitHub Raw 地址', 'githubCdnDomain');
		} else {
			this.addTextSetting(containerEl, 'GitLab Host', '默认 https://gitlab.com', 'gitlabHost');
			this.addTextSetting(containerEl, 'GitLab Project', 'Project ID 或 namespace/project', 'gitlabProject');
			this.addTextSetting(containerEl, 'GitLab Branch', '上传目标分支', 'gitlabBranch');
			this.addTextSetting(containerEl, 'GitLab Path Prefix', '项目内的图片目录', 'gitlabPathPrefix');
		}
		if (this.plugin.settings.provider !== 's3') {
			new Setting(containerEl).setName('Git provider token').setDesc('Token 仅保存在 Obsidian 安全存储中。').addText((text) => {
				text.setValue(this.plugin.getToken()).onChange(async (value) => this.plugin.updateToken(value));
				text.inputEl.type = 'password';
			});
		}

		if (this.plugin.settings.provider === 's3') {
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
		}

		this.addNumberSetting(containerEl, '最大文件大小（字节）', '单个文件允许上传的最大大小', 'maxFileSize');
		if (this.plugin.settings.provider === 's3') {
			this.addNumberSetting(containerEl, '请求超时（毫秒）', '连接 S3 的最大等待时间', 'requestTimeout');
			this.addNumberSetting(containerEl, '重试次数', '网络失败时的重试次数，范围 0 到 5', 'retryCount');
		}

		this.addToggleSetting(containerEl, '粘贴图片时自动上传', '关闭时保留 Obsidian 默认行为', 'autoUploadOnPaste');
		this.addToggleSetting(containerEl, '上传成功后重命名本地文件', '将本地文件名改为远程 UUID 文件名；关闭后保留原文件名', 'renameLocalAfterUpload');
		this.addToggleSetting(containerEl, '上传成功后删除本地文件', '默认关闭，仅在上传成功后删除本地图片', 'deleteLocalAfterUpload');
		this.addToggleSetting(containerEl, '上传失败时回退到本地保存', '推荐开启，确保上传失败时图片仍可使用', 'fallbackToLocalOnFailure');
		this.addToggleSetting(containerEl, '显示上传通知', '显示测试和上传结果通知', 'showUploadNotice');
		if (this.plugin.settings.provider === 's3') this.addToggleSetting(containerEl, '使用 Path-style Endpoint', '部分 S3-compatible 服务需要开启', 'forcePathStyle');

		new Setting(containerEl)
			.setName('连接测试')
			.setDesc(this.plugin.settings.provider === 's3'
				? '验证 endpoint、bucket 和凭证是否具备访问权限。'
				: '验证仓库、项目、分支和 Token 是否具备访问权限。')
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
			.setDesc(this.plugin.hasCredentials()
				? this.plugin.settings.provider === 's3' ? 'Access Key 和 Secret Key 已配置。' : 'Git provider Token 已配置。'
				: this.plugin.settings.provider === 's3' ? '尚未配置完整凭证。' : '尚未配置 Git provider Token。')
			.addButton((button) =>
				button.setButtonText('清除凭证').setWarning().onClick(async () => {
					this.plugin.clearCredentials();
					new Notice(this.plugin.settings.provider === 's3' ? 'S3 凭证已清除。' : 'Git provider Token 已清除。');
					this.display();
				}),
			);
	}

	/** 创建一个字符串配置项，并在变更后保存配置。
	 * @param containerEl 设置项要挂载到的 DOM 容器。
	 * @param name 设置项显示名称。
	 * @param desc 设置项说明文字。
	 * @param key 要编辑的字符串配置字段。
	 * @returns 无返回值。
	 */
	private addTextSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'endpoint' | 'region' | 'bucket' | 'publicUrlPrefix' | 'objectKeyPrefix' | 'githubOwner' | 'githubRepository' | 'githubBranch' | 'githubPathPrefix' | 'githubCdnDomain' | 'gitlabHost' | 'gitlabProject' | 'gitlabBranch' | 'gitlabPathPrefix',
	): void {
		new Setting(containerEl).setName(name).setDesc(desc).addText((text) =>
			text.setValue(this.plugin.settings[key]).onChange(async (value) => {
				this.plugin.settings[key] = value.trim();
				await this.plugin.saveSettings();
			}),
		);
	}

	/** 创建一个数字配置项；非法数字不会写入配置。
	 * @param containerEl 设置项要挂载到的 DOM 容器。
	 * @param name 设置项显示名称。
	 * @param desc 设置项说明文字。
	 * @param key 要编辑的数字配置字段。
	 * @returns 无返回值。
	 */
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

	/** 创建一个布尔策略开关，并在变更后保存配置。
	 * @param containerEl 设置项要挂载到的 DOM 容器。
	 * @param name 开关显示名称。
	 * @param desc 开关说明文字。
	 * @param key 要编辑的布尔策略字段。
	 * @returns 无返回值。
	 */
	private addToggleSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: 'autoUploadOnPaste' | 'renameLocalAfterUpload' | 'deleteLocalAfterUpload' | 'fallbackToLocalOnFailure' | 'showUploadNotice' | 'forcePathStyle',
	): void {
		new Setting(containerEl).setName(name).setDesc(desc).addToggle((toggle) =>
			toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
				this.plugin.settings[key] = value;
				await this.plugin.saveSettings();
			}),
		);
	}
}
