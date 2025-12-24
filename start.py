#!/usr/bin/env python3
"""
统一启动前后端服务
同时启动 FastAPI 后端和 Vite 前端开发服务器
"""

import subprocess
import sys
import os
import signal
import time
from pathlib import Path

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.absolute()

# 进程列表
processes = []


def signal_handler(sig, frame):
    """处理退出信号，清理所有子进程"""
    print("\n\n正在关闭所有服务...")
    for process in processes:
        try:
            if process.poll() is None:  # 进程仍在运行
                process.terminate()
                process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        except Exception as e:
            print(f"关闭进程时出错: {e}")
    sys.exit(0)


def check_dependencies():
    """检查依赖是否安装"""
    print("检查依赖...")

    # 检查Python依赖
    try:
        import fastapi
        import uvicorn
        import requests
    except ImportError as e:
        print(f"❌ Python依赖缺失: {e}")
        print("请运行: pip install -r requirements.txt")
        return False

    # 检查Node.js和npm
    try:
        result = subprocess.run(
            ["npm", "--version"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode != 0:
            print("❌ npm 未安装或不可用")
            return False
    except FileNotFoundError:
        print("❌ npm 未安装，请先安装 Node.js")
        return False

    # 检查node_modules是否存在
    if not (PROJECT_ROOT / "node_modules").exists():
        print("⚠️  node_modules 不存在，正在安装前端依赖...")
        result = subprocess.run(
            ["npm", "install"],
            cwd=PROJECT_ROOT,
            timeout=300
        )
        if result.returncode != 0:
            print("❌ 前端依赖安装失败")
            return False

    print("✅ 依赖检查通过")
    return True


def start_backend():
    """启动后端服务"""
    print("\n🚀 启动后端服务 (FastAPI)...")
    print("   后端地址: http://localhost:8002")
    print("   API文档: http://localhost:8002/docs")

    backend_process = subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "activity.py")],
        cwd=PROJECT_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    processes.append(backend_process)

    # 等待后端启动
    print("   等待后端服务启动...")
    time.sleep(3)

    if backend_process.poll() is not None:
        print("❌ 后端服务启动失败")
        output = backend_process.stdout.read() if backend_process.stdout else ""
        print(output)
        return None

    print("✅ 后端服务已启动")
    return backend_process


def start_frontend():
    """启动前端服务"""
    print("\n🚀 启动前端服务 (Vite)...")
    print("   前端地址: http://localhost:8001")

    frontend_process = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=PROJECT_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )

    processes.append(frontend_process)

    # 等待前端启动
    print("   等待前端服务启动...")
    time.sleep(5)

    if frontend_process.poll() is not None:
        print("❌ 前端服务启动失败")
        output = frontend_process.stdout.read() if frontend_process.stdout else ""
        print(output)
        return None

    print("✅ 前端服务已启动")
    return frontend_process


def print_logs(backend_process, frontend_process):
    """打印服务日志"""
    import threading

    def print_backend_logs():
        if backend_process and backend_process.stdout:
            for line in iter(backend_process.stdout.readline, ''):
                if line:
                    print(f"[后端] {line.rstrip()}")

    def print_frontend_logs():
        if frontend_process and frontend_process.stdout:
            for line in iter(frontend_process.stdout.readline, ''):
                if line:
                    print(f"[前端] {line.rstrip()}")

    # 启动日志打印线程
    if backend_process:
        threading.Thread(target=print_backend_logs, daemon=True).start()
    if frontend_process:
        threading.Thread(target=print_frontend_logs, daemon=True).start()


def main():
    """主函数"""
    print("=" * 60)
    print("Polymarket 交易分析系统 - 统一启动脚本")
    print("=" * 60)

    # 注册信号处理器
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # 检查依赖
    if not check_dependencies():
        sys.exit(1)

    # 启动后端
    backend_process = start_backend()
    if not backend_process:
        signal_handler(None, None)
        sys.exit(1)

    # 启动前端
    frontend_process = start_frontend()
    if not frontend_process:
        signal_handler(None, None)
        sys.exit(1)

    # 打印服务信息
    print("\n" + "=" * 60)
    print("✅ 所有服务已启动成功！")
    print("=" * 60)
    print("\n服务地址:")
    print("  🌐 统一访问: http://localhost:8001")
    print("     - 前端应用和API都通过此端口访问")
    print("     - API请求会自动代理到后端")
    print("\n独立访问:")
    print("  前端应用: http://localhost:8001")
    print("  后端API:  http://localhost:8002")
    print("  API文档:  http://localhost:8002/docs")
    print("\n按 Ctrl+C 停止所有服务")
    print("=" * 60 + "\n")

    # 打印日志
    print_logs(backend_process, frontend_process)

    # 保持运行，等待进程结束
    try:
        while True:
            # 检查进程是否还在运行
            if backend_process.poll() is not None:
                print("\n❌ 后端服务意外退出")
                break
            if frontend_process.poll() is not None:
                print("\n❌ 前端服务意外退出")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        signal_handler(None, None)


if __name__ == "__main__":
    main()
