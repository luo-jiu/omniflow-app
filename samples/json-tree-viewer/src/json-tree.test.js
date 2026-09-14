import { describe, expect, it } from 'vitest';
import { JSON_LIMITS, parseJsonTree, visibleNodes, nodeValue, restoreTreeState } from './json-tree.js';
describe('independent JSON tree model',()=>{
 it('preserves large and exceptional numeric lexemes without IEEE-754 conversion',()=>{
  const {root}=parseJsonTree('[9007199254740993,1e400,-0,0.123456789012345678901]');expect(root.children.map(node=>nodeValue(node))).toEqual(['9007199254740993','1e400','-0','0.123456789012345678901']);
 });
 it('preserves ordered keys, empty containers, escapes and scalar roots',()=>{
  const {root,count}=parseJsonTree('\uFEFF{"z":[],"a":{},"s":"a\\n\\u4e2d","ok":true,"none":null}');expect(count).toBe(6);expect(root.children.map(node=>node.key)).toEqual(['z','a','s','ok','none']);expect(root.children[2].value).toBe('a\n中');expect(parseJsonTree('false').root.type).toBe('boolean');expect(nodeValue(parseJsonTree('"\\ud800"').root)).toBe('"\\ud800"');
 });
 it('keeps prototype-like keys as data rather than assigning them to objects',()=>{const {root}=parseJsonTree('{"__proto__":{"polluted":true},"constructor":1}');expect(root.children[0].key).toBe('__proto__');expect({}.polluted).toBeUndefined();});
 it.each(['','{','[1,]','{"a":1,}','{"a":1,"a":2}','{"a":1,"\\u0061":2}','01','+1','NaN','1e','true false','//x\n{}','"bad\nstring"','"\\q"'])('rejects invalid or ambiguous JSON %s',text=>{expect(()=>parseJsonTree(text)).toThrow();});
 it('bounds depth, nodes, input and scalar lengths',()=>{
  expect(()=>parseJsonTree('['.repeat(65)+'0'+']'.repeat(65))).toThrow(/深度/);
  expect(()=>parseJsonTree('[1,2,3]',{...JSON_LIMITS,nodes:3})).toThrow(/节点/);
  expect(()=>parseJsonTree('"abcd"',{...JSON_LIMITS,stringChars:3})).toThrow(/长度/);
  expect(()=>parseJsonTree('{"abcd":0}',{...JSON_LIMITS,keyChars:3})).toThrow(/长度/);
  expect(()=>parseJsonTree('12345',{...JSON_LIMITS,numberChars:4})).toThrow(/数字/);
  expect(()=>parseJsonTree('"汉字"',{...JSON_LIMITS,bytes:4})).toThrow(/大小/);
 });
 it('flattens only expanded branches and validates restoration ids',()=>{
  const {root,count}=parseJsonTree('{"nested":{"items":[1,2]},"name":"x"}');const all=visibleNodes(root,new Set(Array.from({length:count},(_,i)=>i+1)));
  expect(visibleNodes(root,new Set()).map(node=>node.id)).toEqual([1]);expect(visibleNodes(root,new Set([1])).map(node=>node.key)).toEqual([null,'nested','name']);
  const restored=restoreTreeState({expanded:[1,2,999,'2'],page:-1,scrollTop:Infinity},all);expect([...restored.expanded]).toEqual([1,2]);expect(restored.page).toBe(0);expect(restored.scrollTop).toBe(0);
 });
});
