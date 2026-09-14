import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({ open:vi.fn(), close:vi.fn(), layout:vi.fn(), theme:vi.fn(), subscribe:vi.fn(), wait:vi.fn(), capture:vi.fn() }));
vi.mock('@/service/plugins/plugin-viewer.api',()=>({pluginViewerApi:mocks}));
vi.mock('../../session/useViewerSession',()=>({useViewerSession:()=>({capture:mocks.capture,waitForInitialRestore:mocks.wait})}));
import { PluginViewer } from './index';
const props={accountScope:'a',libraryId:3,nodeId:99,fileUrl:'https://never-forward.test/file',fileName:'test.csv',fileType:'text' as const,tabId:'node:99',viewerId:'example.csv.table',contentRevision:'v1',loading:false,active:true};
function render(input=props) { return create(<PluginViewer {...input}/>,{createNodeMock:()=>({getBoundingClientRect:()=>({x:0,y:0,width:500,height:400})})}); }
function button(tree:ReactTestRenderer,label:string) { return tree.root.findAllByType('button').find(node=>node.children.includes(label))!; }
beforeEach(()=>{
 vi.clearAllMocks();mocks.open.mockResolvedValue({ok:true});mocks.close.mockResolvedValue(undefined);mocks.layout.mockResolvedValue(undefined);mocks.theme.mockResolvedValue(undefined);mocks.wait.mockResolvedValue('none');mocks.subscribe.mockReturnValue(()=>undefined);
 vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
});
describe('first-party viewer lifecycle',()=>{
 it('requires explicit file grant and never passes a file URL',async()=>{
  let tree!:ReactTestRenderer;await act(async()=>{tree=render()});expect(mocks.open).not.toHaveBeenCalled();
  await act(async()=>button(tree,'允许读取此文件').props.onClick());expect(mocks.open).toHaveBeenCalledTimes(1);expect(mocks.open.mock.calls[0][0]).not.toHaveProperty('fileUrl');
  await act(async()=>button(tree,'撤销读取授权').props.onClick());expect(mocks.close).toHaveBeenCalled();await act(async()=>tree.unmount());
 });
 it('closes inactive views and does not carry a grant into another account or node',async()=>{
  let tree!:ReactTestRenderer;await act(async()=>{tree=render()});await act(async()=>button(tree,'允许读取此文件').props.onClick());
  await act(async()=>tree.update(<PluginViewer {...props} active={false}/>));expect(mocks.close).toHaveBeenCalled();
  await act(async()=>tree.update(<PluginViewer {...props} accountScope="other"/>));expect(button(tree,'允许读取此文件')).toBeTruthy();expect(mocks.open).toHaveBeenCalledTimes(1);
  await act(async()=>tree.unmount());
 });
 it('closes a late open result after unmount',async()=>{
  let resolve!:(value:unknown)=>void;mocks.open.mockImplementation(()=>new Promise(done=>{resolve=done}));
  let tree!:ReactTestRenderer;await act(async()=>{tree=render()});await act(async()=>button(tree,'允许读取此文件').props.onClick());
  await act(async()=>tree.unmount());await act(async()=>resolve({ok:true}));expect(mocks.close).toHaveBeenCalledTimes(2);
 });
});
