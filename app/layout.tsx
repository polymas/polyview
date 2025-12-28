import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Polymarket 交易分析',
  description: '输入钱包地址，查看历史交易记录和盈亏分析',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}

