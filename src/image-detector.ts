import { App, Editor, TFile } from 'obsidian';

export interface ImageReference {
	kind: 'wiki' | 'markdown';
	line: number;
	startCh: number;
	endCh: number;
	original: string;
	target: string;
	altText: string;
}

/** 查找光标所在行中可上传的本地图片引用。
 * @param editor 当前 Markdown 编辑器。
 * @returns 光标所在图片引用；光标不在图片上时返回 null。
 */
export function findImageReferenceAtCursor(
	editor: Editor,
): ImageReference | null {
	const cursor = editor.getCursor();
	const candidates = findImageReferences(editor).filter((reference) => reference.line === cursor.line);
	const reference = candidates.find((candidate) =>
		cursor.ch >= candidate.startCh && cursor.ch < candidate.endCh,
	);
	return reference ? { ...reference, line: cursor.line } : null;
}

/** 扫描当前编辑器中的全部图片引用，并保留每个引用的文档位置。
 * @param editor 当前 Markdown 编辑器。
 * @returns 当前文档中的 Wiki-link 和 Markdown 图片引用。
 */
export function findImageReferences(editor: Editor): ImageReference[] {
	const references: ImageReference[] = [];
	for (const [line, lineText] of editor.getValue().split('\n').entries()) {
		for (const reference of [
			...findWikiImageReferences(lineText),
			...findMarkdownImageReferences(lineText),
		]) {
			references.push({ ...reference, line });
		}
	}
	return references;
}

/** 将图片引用解析为当前 Vault 中的 TFile，远程 URL 不会被解析。
 * @param app 当前 Obsidian App 实例。
 * @param reference 已识别的图片引用。
 * @param sourcePath 当前 Markdown 文件路径，用于解析相对链接。
 * @returns Vault 中的图片文件；无法解析或目标为远程 URL 时返回 null。
 */
export function resolveImageFile(
	app: App,
	reference: ImageReference,
	sourcePath: string,
): TFile | null {
	if (/^(?:https?:|data:|file:)/i.test(reference.target)) return null;
	const target = decodeImagePath(reference.target);
	const file = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
	return file instanceof TFile ? file : null;
}

/** 解码 Markdown 图片路径中的 URL 编码字符，例如文件名中的空格。 */
function decodeImagePath(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

/** 扫描 Wiki-link 图片语法并保留其别名作为 alt 文本。
 * @param lineText 待扫描的 Markdown 行文本。
 * @returns 当前行中识别到的 Wiki-link 图片引用。
 */
function findWikiImageReferences(lineText: string): ImageReference[] {
	const references: ImageReference[] = [];
	const pattern = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
	for (const match of lineText.matchAll(pattern)) {
		const target = match[1]?.trim();
		if (!target || match.index === undefined) continue;
		references.push({
			kind: 'wiki',
			line: 0,
			startCh: match.index,
			endCh: match.index + match[0].length,
			original: match[0],
			target,
			altText: match[2]?.trim() || target.split('/').pop() || 'image',
		});
	}
	return references;
}

/** 扫描 Markdown 图片语法并保留 alt 文本。
 * @param lineText 待扫描的 Markdown 行文本。
 * @returns 当前行中识别到的 Markdown 图片引用。
 */
function findMarkdownImageReferences(lineText: string): ImageReference[] {
	const references: ImageReference[] = [];
	const pattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
	for (const match of lineText.matchAll(pattern)) {
		const target = match[2]?.trim();
		if (!target || match.index === undefined) continue;
		references.push({
			kind: 'markdown',
			line: 0,
			startCh: match.index,
			endCh: match.index + match[0].length,
			original: match[0],
			target,
			altText: match[1] || 'image',
		});
	}
	return references;
}
