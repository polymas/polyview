#!/usr/bin/env python3
"""
服务自动重启脚本
监控前后端服务，如果服务崩溃则自动重启
支持后台运行（daemon模式）

使用方法:
1. 前台运行: python auto_restart.py
2. 后台运行: python auto_restart.py --daemon
3. 停止服务: python auto_restart.py --stop
4. 查看状态: python auto_restart.py --status
"""

import subprocess
import sys
import os
import signal
import time
import argparse
import atexit
from pathlib import Path
from datetime import datetime

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.absolute()

# 配置（可通过环境变量覆盖）
HOST = os.getenv('HOST', '0.0.0.0')
BACKEND_PORT = int(os.getenv('BACKEND_PORT', '8002'))
FRONTEND_PORT = int(os.getenv('FRONTEND_PORT', '8001'))
API_TARGET = os.getenv('API_TARGET', f'http://{HOST}:{BACKEND_PORT}')

# PID文件路径
PID_FILE = PROJECT_ROOT / '.auto_restart.pid'
LOG_FILE = PROJECT_ROOT / 'auto_restart.log'

# 进程对象
backend_process = None
frontend_process = None
running = True
daemon_mode = False


def log(message):
    """记录日志"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_msg = f"[{timestamp}] {message}\n"
    
    if not daemon_mode:
        print(log_msg.rstrip())
    
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_msg)
    except Exception:
        pass


def write_pid():
    """写入PID文件"""
    try:
        with open(PID_FILE, 'w') as f:
            f.write(str(os.getpid()))
    except Exception as e:
        log(f"写入PID文件失败: {e}")


def read_pid():
    """读取PID文件"""
    try:
        if PID_FILE.exists():
            with open(PID_FILE, 'r') as f:
                return int(f.read().strip())
    except Exception:
        pass
    return None


def cleanup():
    """清理资源"""
    global backend_process, frontend_process, running
    running = False
    
    log("正在停止所有服务...")
    
    # 停止后端
    if backend_process:
        try:
            if backend_process.poll() is None:
                backend_process.terminate()
                backend_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend_process.kill()
        except Exception as e:
            log(f"停止后端服务时出错: {e}")
    
    # 停止前端
    if frontend_process:
        try:
            if frontend_process.poll() is None:
                frontend_process.terminate()
                frontend_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            frontend_process.kill()
        except Exception as e:
            log(f"停止前端服务时出错: {e}")
    
    # 删除PID文件
    if PID_FILE.exists():
        try:
            PID_FILE.unlink()
        except Exception:
            pass
    
    log("所有服务已停止")


def signal_handler(sig, frame):
    """信号处理器"""
    log(f"收到信号 {sig}，准备退出...")
    cleanup()
    sys.exit(0)


def check_port(port):
    """检查端口是否被占用"""
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    result = sock.connect_ex(('localhost', port))
    sock.close()
    return result == 0


def start_backend():
    """启动后端服务"""
    global backend_process
    
    if backend_process and backend_process.poll() is None:
        return backend_process
    
    log(f"🚀 启动后端服务 (FastAPI) - http://{HOST}:{BACKEND_PORT}")
    
    backend_process = subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "activity.py")],
        cwd=PROJECT_ROOT,
        env={**os.environ, 'HOST': HOST, 'PORT': str(BACKEND_PORT)},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    
    # 等待后端启动
    time.sleep(3)
    
    if backend_process.poll() is not None:
        log("❌ 后端服务启动失败")
        if backend_process.stdout:
            output = backend_process.stdout.read()
            log(f"错误输出: {output[:500]}")
        backend_process = None
        return None
    
    log("✅ 后端服务已启动")
    return backend_process


def start_frontend():
    """启动前端服务"""
    global frontend_process
    
    if frontend_process and frontend_process.poll() is None:
        return frontend_process
    
    log(f"🚀 启动前端服务 (Vite) - http://{HOST}:{FRONTEND_PORT}")
    
    frontend_process = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=PROJECT_ROOT,
        env={**os.environ, 'VITE_PORT': str(FRONTEND_PORT), 'VITE_API_TARGET': API_TARGET},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    
    # 等待前端启动
    time.sleep(5)
    
    if frontend_process.poll() is not None:
        log("❌ 前端服务启动失败")
        if frontend_process.stdout:
            output = frontend_process.stdout.read()
            log(f"错误输出: {output[:500]}")
        frontend_process = None
        return None
    
    log("✅ 前端服务已启动")
    return frontend_process


def monitor_services():
    """监控服务"""
    global backend_process, frontend_process, running
    
    log("开始监控服务...")
    restart_count_backend = 0
    restart_count_frontend = 0
    max_restarts_per_hour = 10  # 每小时最多重启10次
    last_restart_backend = {}
    last_restart_frontend = {}
    
    while running:
        try:
            # 检查后端服务
            if backend_process is None or backend_process.poll() is not None:
                # 检查重启频率限制
                now = time.time()
                recent_restarts = [
                    t for t in last_restart_backend.values()
                    if now - t < 3600  # 1小时内
                ]
                
                if len(recent_restarts) >= max_restarts_per_hour:
                    log(f"⚠️ 后端服务重启过于频繁（1小时内{len(recent_restarts)}次），暂停重启")
                    time.sleep(60)  # 等待1分钟再检查
                    continue
                
                log("检测到后端服务已停止，准备重启...")
                last_restart_backend[restart_count_backend] = now
                restart_count_backend += 1
                start_backend()
            
            # 检查前端服务
            if frontend_process is None or frontend_process.poll() is not None:
                # 检查重启频率限制
                now = time.time()
                recent_restarts = [
                    t for t in last_restart_frontend.values()
                    if now - t < 3600  # 1小时内
                ]
                
                if len(recent_restarts) >= max_restarts_per_hour:
                    log(f"⚠️ 前端服务重启过于频繁（1小时内{len(recent_restarts)}次），暂停重启")
                    time.sleep(60)  # 等待1分钟再检查
                    continue
                
                log("检测到前端服务已停止，准备重启...")
                last_restart_frontend[restart_count_frontend] = now
                restart_count_frontend += 1
                start_frontend()
            
            # 每30秒检查一次
            time.sleep(30)
            
        except KeyboardInterrupt:
            log("收到中断信号")
            break
        except Exception as e:
            log(f"监控过程中出错: {e}")
            time.sleep(30)


def daemonize():
    """后台运行"""
    try:
        pid = os.fork()
        if pid > 0:
            # 父进程退出
            sys.exit(0)
    except OSError as e:
        log(f"fork失败: {e}")
        sys.exit(1)
    
    # 子进程继续
    os.chdir(PROJECT_ROOT)
    os.setsid()
    os.umask(0)
    
    # 再次fork
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)
    except OSError as e:
        log(f"第二次fork失败: {e}")
        sys.exit(1)
    
    # 重定向标准输入输出
    sys.stdout.flush()
    sys.stderr.flush()
    
    # 关闭文件描述符
    try:
        si = open(os.devnull, 'r')
        so = open(os.devnull, 'a+')
        se = open(os.devnull, 'a+')
        os.dup2(si.fileno(), sys.stdin.fileno())
        os.dup2(so.fileno(), sys.stdout.fileno())
        os.dup2(se.fileno(), sys.stderr.fileno())
    except Exception:
        pass


def stop_service():
    """停止服务"""
    pid = read_pid()
    if pid is None:
        print("服务未运行")
        return
    
    try:
        os.kill(pid, signal.SIGTERM)
        print(f"已发送停止信号到进程 {pid}")
        time.sleep(2)
        
        # 检查是否还在运行
        try:
            os.kill(pid, 0)
            print("进程仍在运行，强制终止...")
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            print("服务已停止")
        
        if PID_FILE.exists():
            PID_FILE.unlink()
    except ProcessLookupError:
        print("进程不存在")
        if PID_FILE.exists():
            PID_FILE.unlink()
    except PermissionError:
        print(f"权限不足，无法停止进程 {pid}")
    except Exception as e:
        print(f"停止服务时出错: {e}")


def check_status():
    """检查服务状态"""
    pid = read_pid()
    if pid is None:
        print("服务未运行")
        return
    
    try:
        os.kill(pid, 0)
        print(f"服务正在运行 (PID: {pid})")
        
        # 检查端口
        if check_port(BACKEND_PORT):
            print(f"✅ 后端端口 {BACKEND_PORT} 正在监听")
        else:
            print(f"❌ 后端端口 {BACKEND_PORT} 未监听")
        
        if check_port(FRONTEND_PORT):
            print(f"✅ 前端端口 {FRONTEND_PORT} 正在监听")
        else:
            print(f"❌ 前端端口 {FRONTEND_PORT} 未监听")
        
        # 显示日志文件
        if LOG_FILE.exists():
            print(f"\n日志文件: {LOG_FILE}")
            print("最近10行日志:")
            with open(LOG_FILE, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                for line in lines[-10:]:
                    print(line.rstrip())
    except ProcessLookupError:
        print("进程不存在，但PID文件存在")
        PID_FILE.unlink()
    except Exception as e:
        print(f"检查状态时出错: {e}")


def main():
    """主函数"""
    global daemon_mode, running
    
    parser = argparse.ArgumentParser(description='服务自动重启脚本')
    parser.add_argument('--daemon', action='store_true', help='后台运行')
    parser.add_argument('--stop', action='store_true', help='停止服务')
    parser.add_argument('--status', action='store_true', help='查看服务状态')
    
    args = parser.parse_args()
    
    if args.stop:
        stop_service()
        return
    
    if args.status:
        check_status()
        return
    
    # 检查是否已有实例在运行
    pid = read_pid()
    if pid:
        try:
            os.kill(pid, 0)
            print(f"服务已在运行 (PID: {pid})")
            print("使用 --stop 停止服务")
            sys.exit(1)
        except ProcessLookupError:
            # PID文件存在但进程不存在，删除PID文件
            PID_FILE.unlink()
    
    daemon_mode = args.daemon
    
    if daemon_mode:
        log("以后台模式启动...")
        daemonize()
    
    # 注册信号处理器
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    atexit.register(cleanup)
    
    # 写入PID文件
    write_pid()
    
    log("=" * 60)
    log("Polymarket 交易分析系统 - 自动重启服务")
    log("=" * 60)
    log(f"后端地址: http://{HOST}:{BACKEND_PORT}")
    log(f"前端地址: http://{HOST}:{FRONTEND_PORT}")
    log("=" * 60)
    
    # 启动服务
    start_backend()
    start_frontend()
    
    # 开始监控
    monitor_services()
    
    # 清理
    cleanup()


if __name__ == "__main__":
    main()

