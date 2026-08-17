// 唤醒词配置：中文/英文唤醒词 → 模型音素 token 序列 → keywords.txt
// 模型：sherpa-onnx-kws-zipformer-wenetspeech-3.3M（官方）
// tokens：带声调拼音（声母+韵母） + 大写英文字母（A-Z）
// 规则：汉字拆 带声调声母+韵母（pinyin-pro）；英文字母直接用大写字母 token
import { pinyin } from "pinyin-pro";
import fs from "node:fs";

// 单字 → 音素 token 数组（带声调声母+韵母；字母用大写 token）
function charToTokens(ch) {
	if (/[A-Za-z]/.test(ch)) return [ch.toUpperCase()];
	const init = pinyin(ch, { type: "array", pattern: "initial" })[0];
	const fin = pinyin(ch, { type: "array", pattern: "final" })[0];
	const tokens = [];
	if (init) tokens.push(init);
	if (fin) tokens.push(fin);
	return tokens;
}

// 唤醒词 → 音素 token 序列（无法转换的字符跳过；空返回 null）
export function wakeWordToTokens(word) {
	const tokens = [];
	for (const ch of word.trim()) {
		const t = charToTokens(ch);
		if (t.length === 0) continue;
		tokens.push(...t);
	}
	return tokens.length > 0 ? tokens : null;
}

// 生成 keywords.txt（写入模型目录；每行 "tokens @唤醒词"）
export function writeKeywordsFile(modelDir, wakeWords) {
	const lines = [];
	for (const w of wakeWords) {
		const tokens = wakeWordToTokens(w);
		if (tokens) lines.push(`${tokens.join(" ")} @${w}`);
	}
	fs.writeFileSync(`${modelDir}/keywords.txt`, lines.join("\n") + "\n", "utf8");
	return lines;
}
