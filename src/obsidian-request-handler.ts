import { requestUrl } from 'obsidian';
import type { HttpRequest, HttpResponse, RequestHandler } from '@smithy/types';

export class ObsidianRequestHandler implements RequestHandler<HttpRequest, HttpResponse> {
	metadata = { handlerProtocol: 'http/1.1' };

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

function toStringHeaders(headers: Record<string, string | undefined>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

function toRequestBody(body: unknown): string | ArrayBuffer | undefined {
	if (body === undefined || typeof body === 'string' || body instanceof ArrayBuffer) {
		return body;
	}
	if (ArrayBuffer.isView(body)) {
		return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
	}
	return undefined;
}
