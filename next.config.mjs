import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 确保 API routes 在 Vercel 上正常工作
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // 多 lockfile 时指定项目根，消除 Next 误判工作区根目录的警告
  turbopack: {
    root: path.resolve(__dirname),
  },
}

export default nextConfig
