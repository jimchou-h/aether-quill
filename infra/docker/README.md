# 本地开发依赖容器化

本目录包含 Aether Quill 项目所有本地开发依赖的 Docker 配置。

## 服务列表

| 服务 | 版本 | 端口 | 用途 |
|------|------|------|------|
| PostgreSQL | 16-alpine | 5432 | 主数据库 |
| Redis | 7-alpine | 6379 | 队列服务 |
| Qdrant | v1.7.4 | 6333 (HTTP) / 6334 (gRPC) | 向量数据库 |
| MinIO | latest | 9000 (API) / 9001 (Console) | 对象存储 |

## 快速开始

### Windows

```bash
# 一键启动所有服务
infra\docker\start.bat

# 查看服务日志
docker compose -f infra/docker/docker-compose.yml logs

# 停止所有服务
docker compose -f infra/docker/docker-compose.yml down

# 停止并删除数据卷（清空数据）
docker compose -f infra/docker/docker-compose.yml down -v
```

### macOS / Linux

```bash
# 一键启动所有服务
chmod +x infra/docker/start.sh
./infra/docker/start.sh

# 查看服务日志
docker compose -f infra/docker/docker-compose.yml logs

# 停止所有服务
docker compose -f infra/docker/docker-compose.yml down

# 停止并删除数据卷（清空数据）
docker compose -f infra/docker/docker-compose.yml down -v
```

## 环境变量配置

首次运行前，确保项目根目录存在 `.env` 文件：

```bash
# 如果不存在，从示例创建
cp .env.example .env
```

关键配置项（Docker Compose 使用）：

```env
# PostgreSQL
POSTGRES_USER=aether
POSTGRES_PASSWORD=aether123
POSTGRES_DB=aether_quill
POSTGRES_PORT=5432

# Redis
REDIS_PORT=6379

# Qdrant
QDRANT_PORT=6333
QDRANT_GRPC_PORT=6334

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
```

## 服务访问地址

启动成功后，可通过以下地址访问各服务：

- **PostgreSQL**: `localhost:5432`
  - 用户名: `aether`
  - 密码: `aether123`
  - 数据库: `aether_quill`

- **Redis**: `localhost:6379`

- **Qdrant**: `http://localhost:6333`
  - Web UI: `http://localhost:6333/dashboard`

- **MinIO**: `http://localhost:9000`
  - 控制台: `http://localhost:9001`
  - 用户名: `minioadmin`
  - 密码: `minioadmin`

## 健康检查

所有服务都配置了健康检查，启动后自动等待服务就绪：

```bash
# 查看所有容器状态
docker ps

# 查看特定服务日志
docker logs aether-quill-postgres
docker logs aether-quill-redis
docker logs aether-quill-qdrant
docker logs aether-quill-minio
```

## 数据持久化

所有服务数据通过 Docker Volume 持久化：

- `postgres_data`: PostgreSQL 数据
- `redis_data`: Redis 数据
- `qdrant_data`: Qdrant 向量数据
- `minio_data`: MinIO 对象存储数据

数据卷在容器重启后保留，除非显式删除。

## 故障排查

### 端口冲突

如果端口已被占用，修改 `.env` 文件中的端口配置：

```env
POSTGRES_PORT=5433
REDIS_PORT=6380
QDRANT_PORT=6334
MINIO_PORT=9002
```

### 容器启动失败

查看详细日志：

```bash
docker compose -f infra/docker/docker-compose.yml logs -f
```

### 清空所有数据

```bash
docker compose -f infra/docker/docker-compose.yml down -v
docker volume prune
```

## 生产环境部署

生产环境请勿使用此配置，建议：
- 使用云数据库服务（如 AWS RDS、Google Cloud SQL）
- 使用托管 Redis（如 AWS ElastiCache）
- 使用托管向量数据库（如 Qdrant Cloud）
- 使用云对象存储（如 AWS S3、Google Cloud Storage）
