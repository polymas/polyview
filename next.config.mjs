/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 确保 API routes 在 Vercel 上正常工作
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // 禁用 turbopack 以使用标准 webpack（更稳定）
  // turbopack: {
  //   root: process.cwd(),
  // },
}

export default nextConfig
