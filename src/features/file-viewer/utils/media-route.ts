// 应用使用 HashRouter，window.location.pathname 永远是 '/'，路由实际在 location.hash。
// 直接接收 location.hash 而不是 pathname，避免调用方误传。
export function isLibraryWorkspaceRoute(hash: string) {
  // hash 形如 "#/libraries/123" 或 "#/libraries/123?xx=yy"，去掉前导 '#'
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  // 截掉 query / hash-in-hash
  const pathOnly = path.split(/[?#]/)[0];
  return /^\/libraries\/[^/]+\/?$/.test(pathOnly);
}
