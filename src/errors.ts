import { NormalizedError } from './types';

export class S3OperationError extends Error {
	constructor(readonly normalized: NormalizedError) {
		super(normalized.message);
		this.name = 'S3OperationError';
	}
}

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

export function logS3Diagnostic(operation: string, details: Record<string, unknown>): void {
	console.error(`[obsidian-image-upload] ${operation}`, details);
}

function redactEndpoint(endpoint: string): string {
	try {
		const url = new URL(endpoint);
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return '<invalid-endpoint>';
	}
}

function sanitizeDebugMessage(message: string): string {
	return message
		.replace(/(authorization|x-amz-security-token|x-amz-signature|secretaccesskey|accesskeyid)=?[^\s,;]*/gi, '$1=<redacted>')
		.slice(0, 500);
}

function getMeaningfulCode(...candidates: Array<string | undefined>): string {
	return candidates.find((candidate) =>
		typeof candidate === 'string' &&
		candidate.length > 0 &&
		!/^Error|TypeError|AggregateError$/i.test(candidate),
	) ?? '';
}

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
