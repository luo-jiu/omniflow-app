export const JSON_LIMITS = Object.freeze({ bytes: 1048576, nodes: 20000, depth: 64, stringChars: 65536, keyChars: 4096, numberChars: 256, expanded: 128, pageRows: 200 });
/** 只构建有界展示模型；数字保留词法原文，属性不写入普通 JS 对象。 */
export function parseJsonTree(input, limits = JSON_LIMITS) {
  if(typeof input!=='string'||new TextEncoder().encode(input).length>limits.bytes)throw new Error('JSON 超过文件大小限制');
  const text = input.replace(/^\uFEFF/, ''); let offset = 0; let count = 0;
  const fail = message => { const before=text.slice(0,offset);const lines=before.split('\n');throw new Error(`${message}（第 ${lines.length} 行，第 ${lines.at(-1).length+1} 列）`); };
  const whitespace = () => { while (offset < text.length && /[\x20\t\n\r]/.test(text[offset])) offset++; };
  function string(maximum) {
    const start=offset++; let escaped=false;
    for (;offset<text.length;offset++) {
      const char=text[offset];
      if(!escaped && char==='"') {offset++;let value;try{value=JSON.parse(text.slice(start,offset));}catch{fail('字符串转义或控制字符无效');}if(value.length>maximum)fail('字符串或键长度超过限制');return value;}
      if(!escaped&&char==='\\')escaped=true;else escaped=false;
    }
    fail('字符串未闭合');
  }
  function value(depth,key,parentId) {
    whitespace();if(depth>limits.depth)fail('JSON 嵌套深度超过限制');if(++count>limits.nodes)fail('JSON 节点数超过限制');
    const node={id:count,depth,key,parentId,type:'null',value:'null'};const char=text[offset];
    if(char==='{'||char==='['){
      node.type=char==='{'?'object':'array';node.children=[];delete node.value;offset++;whitespace();const end=char==='{'?'}':']';const keys=new Set();
      if(text[offset]===end){offset++;return node;}
      for(let index=0;offset<text.length;index++){
        whitespace();let childKey=index;
        if(node.type==='object'){if(text[offset]!=='"')fail('对象键必须是字符串');childKey=string(limits.keyChars);if(keys.has(childKey))fail('对象中存在重复键');keys.add(childKey);whitespace();if(text[offset++]!==':')fail('缺少冒号');}
        node.children.push(value(depth+1,childKey,node.id));whitespace();
        if(text[offset]===end){offset++;return node;}if(text[offset++]!==',')fail('缺少逗号或结束符');
      }
      fail('对象或数组未闭合');
    }
    if(char==='"'){node.type='string';node.value=string(limits.stringChars);return node;}
    for(const literal of ['true','false','null'])if(text.startsWith(literal,offset)){offset+=literal.length;node.type=literal==='null'?'null':'boolean';node.value=literal;return node;}
    const number=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;number.lastIndex=offset;const match=number.exec(text);
    if(match){if(match[0].length>limits.numberChars)fail('数字长度超过限制');offset=number.lastIndex;node.type='number';node.value=match[0];return node;}
    fail('无效的 JSON 值');
  }
  const root=value(0,null);whitespace();if(offset!==text.length)fail('JSON 值之后存在多余内容');return {root,count};
}
export function visibleNodes(root,expanded){const rows=[];const stack=[root];while(stack.length){const node=stack.pop();rows.push(node);if(node.children&&expanded.has(node.id))for(let i=node.children.length-1;i>=0;i--)stack.push(node.children[i]);}return rows;}
export function nodeValue(node){return node.children?`${node.type==='object'?'对象':'数组'} · ${node.children.length} 项`:node.type==='string'?JSON.stringify(node.value):node.value;}
export function restoreTreeState(value,nodes){const valid=new Set(nodes.filter(node=>node.children).map(node=>node.id));return {expanded:new Set(Array.isArray(value?.expanded)?value.expanded.filter(id=>Number.isSafeInteger(id)&&valid.has(id)).slice(0,JSON_LIMITS.expanded):[nodes[0].id]),page:Number.isSafeInteger(value?.page)&&value.page>=0?value.page:0,scrollTop:Number.isFinite(value?.scrollTop)?Math.max(0,Math.min(10000000,value.scrollTop)):0};}
