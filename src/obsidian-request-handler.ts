import { requestUrl } from 'obsidian';
import type { HttpRequest, HttpResponse, RequestHandler } from '@smithy/types';

export class ObsidianRequestHandler implements RequestHandler<HttpRequest, HttpResponse> {
	metadata = { handlerProtocol: 'http/1.1' };

	/** 将 AWS SDK 已签名的 HTTP 请求转交给 Obsidian requestUrl。
	 * @param request AWS SDK 已完成签名的 HTTP 请求。
	 * @returns 包含 HTTP 状态、响应头和二进制响应体的 SDK 响应。
	 */
	async handle(request: HttpRequest): Promise<{ response: HttpResponse }> {
		const body = toRequestBody(request.body);
		const requestParams = {
			url: buildUrl(request),
			method: request.method,
			headers: toStringHeaders(request.headers),
			throw: false,
			...(body === undefined ? {} : { body }),
		};
		delete requestParams.headers.host;
		delete requestParams.headers['content-length'];
		delete requestParams.headers['transfer-encoding'];
		const response = await requestUrl(requestParams);

		return {
			response: {
				statusCode: response.status,
				headers: response.headers,
				body: new Uint8Array(response.arrayBuffer),
			},
		};
	}
}

/** 将 Smithy 请求的协议、主机、路径和查询参数组装为完整 URL。
 * @param request Smithy HTTP 请求对象。
 * @returns 可传递给 requestUrl 的完整 URL。
 */
function buildUrl(request: HttpRequest): string {
	const port = request.port ? `:${request.port}` : '';
	const url = new URL(`${request.protocol}//${request.hostname}${port}${request.path}`);
	for (const [key, values] of Object.entries(request.query ?? {})) {
		for (const value of Array.isArray(values) ? values : [values]) {
			if (value !== null && value !== undefined) url.searchParams.append(key, value);
		}
	}
	return url.toString();
}

/** 将可能包含 undefined 的 SDK 请求头转换为 requestUrl 可接受的字符串映射。
 * @param headers AWS SDK 生成的请求头集合。
 * @returns 过滤 undefined 后的字符串请求头集合。
 */
function toStringHeaders(headers: Record<string, string | undefined>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

/** 将 SDK body 转换为 Obsidian requestUrl 支持的字符串或 ArrayBuffer。
 * @param body AWS SDK 生成的请求体。
 * @returns requestUrl 支持的请求体，无法转换时返回 undefined。
 */
function toRequestBody(body: unknown): string | ArrayBuffer | undefined {
	if (body === undefined || typeof body === 'string' || body instanceof ArrayBuffer) {
		return body;
	}
	if (ArrayBuffer.isView(body)) {
		return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
	}
	return undefined;
}
