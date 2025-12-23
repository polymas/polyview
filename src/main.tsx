import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'
import './index.css'

// 捕获并忽略来自浏览器扩展的错误（不影响应用错误）
window.addEventListener('error', (event) => {
  // 只忽略明确来自浏览器扩展的错误
  if (
    event.filename?.includes('contentScript') ||
    event.filename?.includes('extension') ||
    (event.message?.includes('MutationObserver') &&
      (event.filename?.includes('solanaActionsContentScript') ||
        event.filename?.includes('extension')))
  ) {
    event.preventDefault();
    console.warn('已忽略浏览器扩展错误:', event.message);
    return false;
  }
  // 其他错误正常显示，不阻止
});

// 捕获未处理的 Promise 拒绝（只忽略扩展相关的）
window.addEventListener('unhandledrejection', (event) => {
  const errorMessage = event.reason?.message || event.reason?.toString() || '';
  if (
    errorMessage.includes('MutationObserver') &&
    (errorMessage.includes('solanaActionsContentScript') ||
      errorMessage.includes('contentScript'))
  ) {
    event.preventDefault();
    console.warn('已忽略浏览器扩展的 Promise 拒绝:', errorMessage);
    return false;
  }
  // 其他错误正常显示
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('找不到 root 元素');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)


