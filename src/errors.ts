import { NormalizedError } from './types';

export class StorageOperationError extends Error {
	/** 创建携带归一化错误信息的 S3 操作异常。
	 * @param normalized 已归一化的错误信息。
	 */
	constructor(readonly normalized: NormalizedError) {
		super(normalized.message);
		this.name = 'S3OperationError';
	}
}

export class S3OperationError extends StorageOperationError {}

/** 将 AWS SDK、Node 和 S3-compatible 服务错误统一归类并脱敏。
 * @param error AWS SDK、网络层或服务商返回的原始异常。
 * @returns 包含用户文案、错误分类和安全诊断字段的错误对象。
 */
export function normalizeS3Error(error: unknown): NormalizedError {
	const candidate = error as {
		name?: string;
		$name?: string;
		$metadata?: { httpStatusCode?: number; requestId?: string; attempts?: number };
		Code?: string;
		code?: string;
		statusCode?: number;
		errno?: string | number;
		message?: string;
		stack?: string;
		cause?: { name?: string; code?: string; errno?: string | number; message?: string; statusCode?: number };
	};
	const cause = candidate.cause;
	const status = candidate.$metadata?.httpStatusCode ?? candidate.statusCode ?? cause?.statusCode;
	const code = getMeaningfulCode(
		candidate.$name,
		candidate.Code,
		candidate.code,
		cause?.code,
		candidate.name,
	);
	const requestId = candidate.$metadata?.requestId;
	const rawMessage = candidate.message ?? cause?.message ?? String(error);
	const debugMessage = sanitizeDebugMessage(formatRawError(error, rawMessage));
	const normalizedBase = {
		debugMessage,
		stack: sanitizeDebugMessage(candidate.stack ?? ''),
		statusCode: status,
		code: code || undefined,
		requestId,
	};

	if (/signaturedoesnotmatch|invalidsignature|authorizationheadermalformed/i.test(code)) {
		return {
			kind: 'configuration',
			message: 'S3 签名验证失败，请检查 Endpoint、Region 和 Path-style 设置。',
			...normalizedBase,
		};
	}
	if (
		status === 401 ||
		/invalidaccesskey|invalidtoken|credential/i.test(code) ||
		/signature|credential|access key|secret key/i.test(rawMessage)
	) {
		return { kind: 'authentication', message: 'S3 凭证无效，请检查 Access Key 和 Secret Key。', ...normalizedBase };
	}
	if (status === 403 || /accessdenied|forbidden|nosuchbucket|invalidbucket/i.test(code)) {
		return { kind: 'permission', message: '没有访问或写入 Bucket 的权限，请检查 Bucket 和权限配置。', ...normalizedBase };
	}
	if (status !== undefined && status >= 500) {
		return { kind: 'server', message: 'S3 服务暂时不可用，请稍后重试。', ...normalizedBase };
	}
	const networkCode = String(candidate.code ?? candidate.errno ?? cause?.code ?? cause?.errno ?? '');
	if (
		/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(networkCode) ||
		/(network|timeout|fetch failed|socket hang up|connect timeout|getaddrinfo)/i.test(rawMessage)
	) {
		return { kind: 'network', message: '无法连接 S3 服务，请检查 Endpoint 和网络连接。', ...normalizedBase };
	}
	return { kind: 'unknown', message: 'S3 操作失败，请检查配置后重试。', ...normalizedBase };
}

/** 生成适合 Notice 展示的错误文案，不包含敏感请求细节。
 * @param error 已归一化的 S3 错误对象。
 * @returns 可直接展示给用户的错误文本。
 */
export function formatErrorForNotice(error: NormalizedError): string {
	const details = [
		error.code ? `错误码: ${error.code}` : '',
		error.statusCode ? `HTTP: ${error.statusCode}` : '',
		error.requestId ? `请求 ID: ${error.requestId}` : '',
	].filter(Boolean).join('，');
	const debugDetails = error.kind === 'unknown' && error.debugMessage
		? `详情: ${error.debugMessage}`
		: '';
	const suffix = [details, debugDetails].filter(Boolean).join('；');
	return suffix ? `${error.message}（${suffix}）` : error.message;
}

/** 将脱敏后的错误上下文写入 Obsidian Console，便于定位服务商兼容性问题。
 * @param operation 当前执行的 S3 操作名称。
 * @param settings 当前连接配置，仅记录非敏感字段。
 * @param error 已归一化的错误对象。
 */
export function logS3Error(operation: string, settings: { endpoint: string; region: string; bucket: string }, error: NormalizedError): void {
	console.error('[obsidian-image-upload] S3 operation failed', {
		operation,
		endpoint: redactEndpoint(settings.endpoint),
		region: settings.region,
		bucket: settings.bucket,
		kind: error.kind,
		statusCode: error.statusCode,
		code: error.code,
		requestId: error.requestId,
		message: error.debugMessage,
		stack: error.stack,
	});
}

/** 输出测试流程阶段日志；不接受凭证和请求体等敏感数据。
 * @param operation 测试流程阶段名称。
 * @param details 要输出的非敏感诊断字段。
 */
export function logS3Diagnostic(operation: string, details: Record<string, unknown>): void {
	console.error(`[obsidian-image-upload] ${operation}`, details);
}

/** 仅保留 Endpoint 的协议、主机和路径，避免日志泄露查询签名。
 * @param endpoint 原始 S3 Endpoint 字符串。
 * @returns 可安全写入日志的 Endpoint 文本。
 */
function redactEndpoint(endpoint: string): string {
	try {
		const url = new URL(endpoint);
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return '<invalid-endpoint>';
	}
}

/** 清理签名、Token 和凭证字段，并限制日志消息长度。
 * @param message 原始异常文本。
 * @returns 脱敏且限制长度后的异常文本。
 */
function sanitizeDebugMessage(message: string): string {
	return message
		.replace(/(authorization|x-amz-security-token|x-amz-signature|secretaccesskey|accesskeyid)=?[^\s,;]*/gi, '$1=<redacted>')
		.slice(0, 500);
}

/** 从候选字段中选取实际 S3/Node 错误码，过滤通用 Error 类型名。
 * @param candidates SDK、网络层和异常对象中的候选错误码。
 * @returns 第一个有意义的错误码；没有时返回空字符串。
 */
function getMeaningfulCode(...candidates: Array<string | undefined>): string {
	return candidates.find((candidate) =>
		typeof candidate === 'string' &&
		candidate.length > 0 &&
		!/^Error|TypeError|AggregateError$/i.test(candidate),
	) ?? '';
}

/** 提取 Error、cause 或普通对象中的可诊断文本。
 * @param error 待提取的原始异常。
 * @param fallback 无法序列化异常时使用的备用文本。
 * @returns 可写入诊断日志的异常文本。
 */
function formatRawError(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		const errorWithCause = error as Error & { cause?: unknown };
		const cause = errorWithCause.cause instanceof Error
			? `; cause=${errorWithCause.cause.name}: ${errorWithCause.cause.message}`
			: errorWithCause.cause
				? `; cause=${safeJson(errorWithCause.cause)}`
				: '';
		return `${error.name}: ${error.message}${cause}`;
	}
	return safeJson(error) || fallback;
}

/** 安全序列化异常对象，并按字段名脱敏潜在凭证和请求内容。
 * @param value 待序列化的未知值。
 * @returns 脱敏后的 JSON 文本；无法序列化时返回空字符串。
 */
function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, (key, nestedValue: unknown) => {
			if (/authorization|credential|secret|token|signature|body|headers/i.test(key)) {
				return '<redacted>';
			}
			return nestedValue;
		});
	} catch {
		return '';
	}
}
