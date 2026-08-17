/**
 * 模型下载脚本:首次运行从 hf-mirror 拉取 sherpa-onnx 预训练模型到目标目录。
 * 用法:node fetch-models.mjs <目标目录>
 * 目录结构与 ~/.dsh/dsh-voice-pet/models 一致:kws/ asr/ tts/ vad/
 * 已存在的文件自动跳过(断点续传语义)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const BASE = process.env.HF_MIRROR || 'https://hf-mirror.com'

const SOURCES = [
  {
    dir: 'kws',
    repo: 'csukuangfj/sherpa-onnx-kws-zipformer-wenetspeech-3.3M',
    files: [
      'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
      'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
      'joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
      'tokens.txt',
    ],
  },
  { dir: 'asr', repo: 'csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14', files: ['model.int8.onnx', 'tokens.txt'] },
  { dir: 'tts', repo: 'csukuangfj/sherpa-onnx-vits-melo-zh_en', files: ['model.int8.onnx', 'tokens.txt', 'lexicon.txt'] },
  { dir: 'vad', repo: 'csukuangfj/silero-vad-onnx', files: ['silero_vad.onnx'] },
]

const target = process.argv[2]
if (!target) {
  console.error('用法: node fetch-models.mjs <目标目录>')
  process.exit(1)
}
fs.mkdirSync(target, { recursive: true })

for (const group of SOURCES) {
  const dir = path.join(target, group.dir)
  fs.mkdirSync(dir, { recursive: true })
  for (const file of group.files) {
    const dest = path.join(dir, file)
    if (fs.existsSync(dest)) {
      console.log('已存在,跳过:', file)
      continue
    }
    const url = `${BASE}/${group.repo}/resolve/main/${file}`
    console.log('下载:', url)
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`下载失败 ${file}: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest))
    console.log('完成:', file)
  }
}
console.log('模型下载完成:', target)
