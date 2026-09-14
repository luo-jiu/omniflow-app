import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import styled from 'styled-components';
import { pluginManagementApi as api } from '@/service/plugins/plugin-management.api';
import type { PluginInstallReview, PluginManagementAction } from '@/shared/plugin-management';
import { AppearanceControlContext } from '@/features/appearance/appearance.context';
import { defaultSelection } from '@/features/appearance/appearance-storage';
import { openCompactConfirm } from '@/components/ui/compact-confirm';
const Page=styled.section`
  color:var(--app-text);font-size:13px;line-height:1.6;padding:16px;max-width:1040px;margin:auto;
  h2{font-size:18px;margin:0}h3{font-size:14px;margin:0}p{margin:6px 0}header,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}header{justify-content:space-between;margin-bottom:16px}
  article,.review,.recovery{border:1px solid var(--app-border-strong);border-radius:10px;background:var(--app-panel);padding:14px;margin:12px 0}
  button{font:inherit;min-height:28px;padding:3px 12px;border:1px solid var(--app-border-strong);border-radius:6px;background:var(--app-bg-elevated);color:var(--app-text);cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--app-focus-border);outline-offset:2px}
  header>div{min-width:0;max-width:100%}h3,small,p{overflow-wrap:anywhere}
  small{color:var(--app-text-secondary)}code{overflow-wrap:anywhere;font-size:11px}details{margin-top:8px}li{overflow-wrap:anywhere}.error{color:var(--app-danger,#c33)}.recovery{border-color:var(--app-focus-border)}
`;
export default function PluginManagement({onBack}:{onBack:()=>void}){
  const catalog=useSyncExternalStore(api.subscribe,api.getSnapshot);
  const loadError=useSyncExternalStore(api.subscribe,api.getError);
  const appearance=useContext(AppearanceControlContext);
  const [review,setReview]=useState<PluginInstallReview|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  useEffect(()=>{api.start();},[]);
  useEffect(()=>()=>{if(review)void api.discard(review.ticket);},[review]);
  const run=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setMessage('');try{await action();}catch(error){setMessage(error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''):'插件操作失败，请重试。');}finally{setBusy(false);}};
  const action=(id:string,value:PluginManagementAction)=>{
    if(value==='uninstall'||value==='clear-data'||value==='rollback'){
      openCompactConfirm({title:value==='uninstall'?'卸载插件？':value==='rollback'?'回滚到保留版本？':'清除插件设置？',content:value==='uninstall'?'将停止并移除插件，用户文件、设置和阅读快照保留。':value==='rollback'?'将停止当前版本并恢复保留包。回滚后需要重新启用和授权，旧版本使用自己的设置。':'仅清除该插件所有版本的本机设置；不删除用户文件或已有阅读快照。',onOk:()=>run(()=>api.action(id,value)),okText:'确定',cancelText:'取消'});
    }else void run(()=>api.action(id,value));
  };
  if(!api.available())return <Page><button onClick={onBack}>返回设置</button><h2>插件管理</h2><p>当前平台暂未开放插件运行与安装。</p></Page>;
  return <Page>
    <header><div><h2>插件管理</h2><small>本地安装 · 只读查看器</small></div><div className="actions"><button disabled={busy} onClick={onBack}>返回设置</button><button disabled={busy} onClick={()=>void run(async()=>{const next=await api.choose();if(next)setReview(next);})}>安装 / 更新本地包</button><button disabled={busy} onClick={()=>void api.refresh()}>刷新</button></div></header>
    <div className="recovery"><h3>恢复与安全启动</h3><p>{catalog?.safeMode?'已阻止第三方插件运行，内置能力仍可使用。':'第三方插件仅在启用并取得当前文件授权后运行。'}</p>{catalog?.recoveryReason&&<p role="status">{catalog.recoveryReason}</p>}<div className="actions"><button disabled={busy||!catalog} onClick={()=>void run(()=>api.safeMode(!catalog?.safeMode))}>{catalog?.safeMode?'解除恢复模式':'立即禁用第三方运行'}</button><button disabled={busy||!appearance} onClick={()=>{if(appearance){const ticket=appearance.preview(defaultSelection());appearance.confirm(ticket);}}}>恢复内置外观</button></div></div>
    {catalog?.settingsRecoveryRequired&&<div className="recovery"><p>插件设置损坏，设置读写已暂停。可保留原文件备份后重置；用户文件和阅读快照不受影响。</p><button disabled={busy} onClick={()=>openCompactConfirm({title:'备份并重置损坏设置？',content:'将停止插件，备份原设置文件并重置所有插件的本机设置。备份最多保留三份，不删除用户文件或阅读快照。',okText:'备份并重置',cancelText:'取消',onOk:()=>run(()=>api.repairSettings())})}>备份并重置损坏设置</button></div>}
    {(message||loadError)&&<p className="error" role="alert">{message||loadError}</p>}
    {!catalog&&!loadError&&<p role="status">正在读取插件状态…</p>}
    {busy&&<p role="status">正在处理插件操作…</p>}
    {review&&<div className="review" aria-label="安装预检"><h3>确认{review.previousVersion?'更新':'安装'}：{review.id}</h3><p>{review.previousVersion?`${review.previousVersion} → `:''}{review.version}</p><p>来源：本地选择的 {review.fileName}。发布者未经验证。</p><p>请求能力：{review.permissions.join('、')||'无正文读取权限'}；新增：{review.addedPermissions.join('、')||'无'}</p><p><code>SHA-256 {review.fingerprint}</code></p><p>预检 5 分钟内有效。提交后保持停用，需重新启用和批准读取能力；每个文件仍须单独授权。</p><div className="actions"><button disabled={busy} onClick={()=>void run(async()=>{await api.commit(review.ticket);setReview(null);})}>确认安装</button><button disabled={busy} onClick={()=>void run(async()=>{await api.discard(review.ticket);setReview(null);})}>取消</button></div></div>}
    {catalog?.plugins.length===0&&<p>暂无已安装插件。可选择本地 ZIP 包进行预检。</p>}
    {catalog?.plugins.map(plugin=><article key={plugin.id} aria-label={`插件 ${plugin.id}`}>
      <header><div><h3>{plugin.viewers[0]?.title??plugin.id}</h3><small>{plugin.id} · {plugin.version} · {plugin.source==='bundled'?'随应用提供':'本地包 / 发布者未验证'}</small></div><span role="status">{plugin.blockedReason?'已阻止':!plugin.enabled?'已停用':plugin.running?`运行中（${plugin.running}）`:'已启用'}{plugin.permissions.includes('resource.read')&&!plugin.readApproved?' · 待读取批准':''}</span></header>
      {plugin.blockedReason&&<p>{plugin.blockedReason}</p>}
      <p>能力：{plugin.permissions.includes('resource.read')?'读取当前获准文件，不能修改文件或访问其他资源。':'无正文读取能力。'}</p>
      <div className="actions"><button disabled={busy} onClick={()=>action(plugin.id,plugin.enabled?'disable':'enable')}>{plugin.enabled?'停用':'启用'}</button>{plugin.permissions.includes('resource.read')&&<button disabled={busy} onClick={()=>action(plugin.id,plugin.readApproved?'revoke-read':'approve-read')}>{plugin.readApproved?'撤销读取批准':'批准读取能力'}</button>}{plugin.previousVersion&&<button disabled={busy} onClick={()=>action(plugin.id,'rollback')}>回滚到 {plugin.previousVersion}</button>}{plugin.source==='local'&&<button disabled={busy} onClick={()=>action(plugin.id,'uninstall')}>卸载</button>}<button disabled={busy} onClick={()=>action(plugin.id,'clear-data')}>清除设置</button></div>
      <details><summary>版本、贡献与完整性</summary><p>安装时间：{plugin.installedAt}</p><code>{plugin.fingerprint}</code><ul>{plugin.viewers.map(viewer=><li key={viewer.id}>{viewer.id}：{viewer.extensions.map(ext=>'.'+ext).join('、')}</li>)}</ul></details>
    </article>)}
    <details><summary>最近操作与失败日志（最多 128 条）</summary>{!catalog?.logs.length?<p>暂无记录。</p>:<ul>{[...catalog.logs].reverse().map((log,index)=><li key={index}>{log.time} · {log.pluginId??'宿主'} · {log.action} · {log.code}{log.instanceId ? ` · 实例 ${log.instanceId.slice(0,8)}` : ''}{log.requestTag ? ` · 请求 ${log.requestTag}` : ''}</li>)}</ul>}</details>
  </Page>;
}
