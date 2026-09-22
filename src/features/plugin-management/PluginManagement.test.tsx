import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({catalog:null as any, choose:vi.fn(),commit:vi.fn(),discard:vi.fn(),action:vi.fn(),safeMode:vi.fn(),confirm:vi.fn()}));
vi.mock('@/service/plugins/plugin-management.api',()=>({pluginManagementApi:{available:()=>true,getSnapshot:()=>mocks.catalog,getError:()=>'',subscribe:()=>()=>undefined,start:()=>undefined,refresh:vi.fn(),choose:mocks.choose,commit:mocks.commit,discard:mocks.discard,action:mocks.action,safeMode:mocks.safeMode}}));
vi.mock('@/components/ui/compact-confirm',()=>({openCompactConfirm:mocks.confirm}));
import PluginManagement from './PluginManagement';
function button(tree:ReactTestRenderer,text:string){return tree.root.findAllByType('button').find(node=>node.children.includes(text))!;}
beforeEach(()=>{vi.clearAllMocks();mocks.catalog={revision:1,safeMode:false,plugins:[],logs:[]};mocks.discard.mockResolvedValue(undefined);mocks.action.mockResolvedValue(undefined);mocks.safeMode.mockResolvedValue(undefined);});
describe('plugin management review and host-owned state',()=>{
 it('shows a review before commit and discards abandoned preflight',async()=>{
  mocks.choose.mockResolvedValue({ticket:'ticket',id:'test.plugin',version:'1.0.0',fingerprint:'a'.repeat(64),permissions:['resource.read'],addedPermissions:['resource.read'],fileName:'test.zip'});
  let tree!:ReactTestRenderer;await act(async()=>{tree=create(<PluginManagement onBack={()=>undefined}/>);});await act(async()=>button(tree,'安装 / 更新本地包').props.onClick());
  expect(mocks.commit).not.toHaveBeenCalled();expect(tree.root.findByProps({'aria-label':'安装预检'})).toBeTruthy();await act(async()=>tree.unmount());expect(mocks.discard).toHaveBeenCalledWith('ticket');
 });
 it('does not implicitly approve reads when enabling and keeps state controlled by the host',async()=>{
  mocks.catalog.plugins=[{id:'test.plugin',version:'1.0.0',fingerprint:'a'.repeat(64),enabled:false,readApproved:false,source:'local',installedAt:'now',permissions:['resource.read'],viewers:[{id:'test.plugin.csv',title:'Test',extensions:['csv']}],running:0}];
  let tree!:ReactTestRenderer;await act(async()=>{tree=create(<PluginManagement onBack={()=>undefined}/>);});await act(async()=>button(tree,'启用').props.onClick());
  expect(mocks.action).toHaveBeenCalledTimes(1);expect(mocks.action).toHaveBeenCalledWith('test.plugin','enable');expect(button(tree,'批准读取能力')).toBeTruthy();expect(button(tree,'启用')).toBeTruthy();await act(async()=>tree.unmount());
 });
 it('explains retained data before uninstall and does not mutate until confirmation',async()=>{
  mocks.catalog.plugins=[{id:'test.plugin',version:'1.0.0',fingerprint:'a'.repeat(64),enabled:false,readApproved:false,source:'local',installedAt:'now',permissions:[],viewers:[],running:0}];
  let tree!:ReactTestRenderer;await act(async()=>{tree=create(<PluginManagement onBack={()=>undefined}/>);});await act(async()=>button(tree,'卸载').props.onClick());expect(mocks.action).not.toHaveBeenCalled();expect(mocks.confirm.mock.calls[0][0].content).toContain('用户文件、设置和阅读快照保留');await act(async()=>tree.unmount());
 });
});

describe('Agent Tool capability projection',()=>{
 it('shows metadata-only rename approval without implying file content or write access',async()=>{
  mocks.catalog.plugins=[{id:'example.batch-rename',version:'0.1.0',fingerprint:'b'.repeat(64),enabled:true,readApproved:false,renameApproved:false,toolApproved:false,source:'local',installedAt:'now',permissions:['resource.rename.propose','agent.tools'],viewers:[],agentTools:[{id:'example.batch-rename.propose',kind:'rename-proposal',title:'批量改名提案',description:'添加文件名前后缀'}],running:0}];
  let tree!:ReactTestRenderer;await act(async()=>{tree=create(<PluginManagement onBack={()=>undefined}/>);});
  expect(JSON.stringify(tree.toJSON())).toContain('实际改名由宿主另行预览确认后执行');expect(button(tree,'批准读取能力')).toBeUndefined();
  await act(async()=>button(tree,'批准改名提案能力').props.onClick());expect(mocks.action).toHaveBeenCalledWith('example.batch-rename','approve-rename');expect(mocks.action).toHaveBeenCalledTimes(1);
  expect(button(tree,'批准 Agent Tool 能力')).toBeTruthy();await act(async()=>tree.unmount());
 });
 it('shows Tool-only packages and sends independent approval without granting session resource access',async()=>{
  mocks.catalog.plugins=[{id:'test.tools',version:'1.0.0',fingerprint:'b'.repeat(64),enabled:true,readApproved:true,toolApproved:false,source:'local',installedAt:'now',permissions:['resource.read','agent.tools'],viewers:[],agentTools:[{id:'test.tools.read',title:'文件分析',description:'本次授权文件分析'}],running:0}];
  let tree!:ReactTestRenderer;await act(async()=>{tree=create(<PluginManagement onBack={()=>undefined}/>);});
  expect(tree.root.findAllByType('h3').some(node=>node.children.includes('文件分析'))).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('不会授予会话资源权限');
  await act(async()=>button(tree,'批准 Agent Tool 能力').props.onClick());expect(mocks.action).toHaveBeenCalledWith('test.tools','approve-tools');
  expect(mocks.action).toHaveBeenCalledTimes(1);expect(button(tree,'撤销读取批准')).toBeTruthy();
  await act(async()=>tree.unmount());
 });
});
