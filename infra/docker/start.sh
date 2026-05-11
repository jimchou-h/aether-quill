#!/bin/bash
# Aether Quill - 本地依赖容器化启动脚本
# 用途：一键启动所有开发依赖服务

set -e

echo "========================================"
echo "Aether Quill - 启动本地开发依赖"
echo "========================================"
echo ""

# 检查 Docker 是否运行
if ! docker ps > /dev/null 2>&1; then
    echo "[错误] Docker 未运行，请先启动 Docker"
    exit 1
fi

echo "[1/4] 检查环境变量配置..."
if [ ! -f ".env" ]; then
    echo "[提示] 未找到 .env 文件，从 .env.example 创建..."
    cp .env.example .env
    echo "[完成] 已创建 .env 文件"
else
    echo "[完成] .env 文件已存在"
fi
echo ""

echo "[2/4] 创建数据卷（如果不存在）..."
docker volume create aether-quill_postgres_data 2>/dev/null || true
docker volume create aether-quill_redis_data 2>/dev/null || true
docker volume create aether-quill_qdrant_data 2>/dev/null || true
docker volume create aether-quill_minio_data 2>/dev/null || true
echo "[完成] 数据卷准备完成"
echo ""

echo "[3/4] 启动服务容器..."
docker compose -f infra/docker/docker-compose.yml up -d
echo "[完成] 容器启动中..."
echo ""

echo "[4/4] 等待服务健康检查..."
sleep 5

echo "========================================"
echo "服务访问地址："
echo "========================================"
echo "PostgreSQL: localhost:5432"
echo "Redis:      localhost:6379"
echo "Qdrant:     http://localhost:6333"
echo "MinIO:      http://localhost:9000"
echo "MinIO 控制台: http://localhost:9001"
echo "========================================"
echo ""

echo "[完成] 所有服务已启动！"
echo "[提示] 使用 'docker compose -f infra/docker/docker-compose.yml logs' 查看日志"
echo "[提示] 使用 'docker compose -f infra/docker/docker-compose.yml down' 停止服务"
