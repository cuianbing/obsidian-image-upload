import { Editor } from 'obsidian';
import { ImageReference } from './image-detector';

/** 将当前图片引用替换为公开 Markdown 图片链接。
 * @param editor 当前 Markdown 编辑器。
 * @param reference 待替换图片引用及其编辑器位置。
 * @param url 上传成功后返回的公开图片 URL。
 * @returns 无返回值；编辑器内容会被原地更新。
 */
export function replaceImageReference(
	editor: Editor,
	reference: ImageReference,
	url: string,
): void {
	const replacement = `![${reference.altText}](${url})`;

	editor.replaceRange(replacement, {
		line: reference.line,
		ch: reference.startCh,
	}, {
		line: reference.line,
		ch: reference.endCh,
	});
}
