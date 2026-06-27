# Docker 部署

## 1. 准备环境变量

复制示例文件：

```bash
cp .env.example .env
```

如果 Dify 跑在宿主机本地 Docker 或本机服务里，Docker 容器内不能使用 `127.0.0.1` 访问宿主机，需要使用：

```bash
DOCKER_DIFY_API_BASE_URL=http://host.docker.internal/v1
```

本地开发仍然可以保留：

```bash
DIFY_API_BASE_URL=http://127.0.0.1/v1
```

语音播报需要配置对应 TTS Key，例如：

```bash
TTS_PROVIDER=siliconflow
SILICONFLOW_API_KEY=你的硅基流动Key
```

## 2. 启动

```bash
docker compose up -d --build
```

如果拉取 `node:22-alpine` 超时，先配置 Docker 镜像源，或手动重试：

```bash
docker pull node:22-alpine
docker compose up -d --build
```

访问：

```text
http://127.0.0.1:4174
```

## 3. 查看状态

```bash
docker compose ps
docker compose logs -f ev-trike-platform
```

健康检查：

```bash
curl http://127.0.0.1:4174/api/health
```

## 4. 数据持久化

`docker-compose.yml` 会把本地 `./data` 挂载到容器 `/app/data`。

这会保留：

- 车型配置
- FAQ 和产品资料
- Dify 工作流绑定
- 聊天记录

注意：`.gitignore` 已排除 `data/dify-workflows.json` 和 `data/chat-history.json`，它们不会提交到 GitHub，但本地 Docker 会继续使用。

## 5. 更新部署

```bash
docker compose down
docker compose up -d --build
```
