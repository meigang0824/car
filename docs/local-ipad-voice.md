# iPad 局域网语音输入测试

语音输入依赖浏览器麦克风能力。通过局域网 IP 访问时，必须使用 HTTPS，否则浏览器会把页面判定为不安全上下文，麦克风会失效。

当前项目已经不再依赖 iPad 浏览器内置的 `SpeechRecognition`。iPad 会使用更稳的模型识别流程：

```text
前端录音 -> 后端 /api/asr/transcribe -> 硅基流动 ASR -> 返回文字 -> 发送给智能客服
```

## 1. 生成本机 HTTPS 证书

```bash
npm run cert:dev
```

脚本会自动把当前电脑的局域网 IP 写入证书，例如：

```text
https://192.168.31.140:5173
```

证书文件生成在 `certs/` 目录，该目录不会提交到 Git。

## 2. 启动项目

```bash
npm run dev
```

电脑本机访问：

```text
https://localhost:5173
```

iPad 局域网访问：

```text
https://电脑局域网IP:5173
```

## 3. iPad 信任证书

第一次访问会提示证书不受信任。需要把 `certs/local-dev-cert.pem` 发送到 iPad，并在系统里安装和信任：

1. 用 AirDrop、微信文件或其他方式把 `certs/local-dev-cert.pem` 发到 iPad。
2. iPad 打开证书并安装描述文件。
3. 进入 `设置 > 通用 > 关于本机 > 证书信任设置`。
4. 打开该本地开发证书的完全信任。
5. 重新打开浏览器访问 HTTPS 地址，并允许麦克风权限。

## 4. 注意

iPad 上所有浏览器都使用 iOS WebKit。HTTPS 解决麦克风安全上下文问题，语音识别本身由后端模型完成。

`.env` 需要包含：

```bash
SILICONFLOW_API_KEY=你的硅基流动Key
SILICONFLOW_ASR_MODEL=FunAudioLLM/SenseVoiceSmall
```

如果语音识别和语音播报想分开使用不同 Key，可以额外配置：

```bash
SILICONFLOW_ASR_API_KEY=你的语音识别专用Key
```
