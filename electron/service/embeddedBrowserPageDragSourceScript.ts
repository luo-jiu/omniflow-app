import { EMBEDDED_BROWSER_PAGE_DRAG_DATA_TYPE } from '../../src/features/file-transfer/model/browser-drag-transfer'

export const EMBEDDED_BROWSER_PAGE_DRAG_CONSOLE_PREFIX = '__OMNIFLOW_PAGE_DRAG__:'

export function createEmbeddedBrowserPageDragSourceScript(tabId: string): string {
  return `(function(){
  if(window.__OMNIFLOW_PAGE_DRAG_SOURCE__)return;
  window.__OMNIFLOW_PAGE_DRAG_SOURCE__=true;
  var PREFIX=${JSON.stringify(EMBEDDED_BROWSER_PAGE_DRAG_CONSOLE_PREFIX)};
  var DATA_TYPE=${JSON.stringify(EMBEDDED_BROWSER_PAGE_DRAG_DATA_TYPE)};
  var TAB_ID=${JSON.stringify(String(tabId || ''))};
  function normalizeUrl(value){
    try{
      var raw=String(value||'').trim();
      if(!raw)return'';
      var url=new URL(raw,location.href);
      return /^(https?:|blob:|data:)$/.test(url.protocol)?url.href:'';
    }catch(e){return''}
  }
  function closestFromEvent(event,selector){
    try{
      var path=typeof event.composedPath==='function'?event.composedPath():[];
      for(var i=0;i<path.length;i+=1){
        var item=path[i];
        if(item&&typeof item.matches==='function'&&item.matches(selector))return item;
      }
      return event.target&&typeof event.target.closest==='function'?event.target.closest(selector):null;
    }catch(e){return null}
  }
  function fileNameFromUrl(url){
    try{
      var parsed=new URL(url);
      var value=decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop()||'');
      return value.replace(/[\\\\/:*?"<>|]/g,'_').trim();
    }catch(e){return''}
  }
  function looksLikeFileUrl(url){
    try{
      var pathname=new URL(url).pathname.toLowerCase();
      var name=pathname.split('/').pop()||'';
      var dot=name.lastIndexOf('.');
      if(dot<=0)return false;
      var extension=name.slice(dot+1);
      return '7z|apng|avif|avi|bmp|csv|doc|docx|epub|flac|gif|gz|ico|jpeg|jpg|json|m4a|mkv|mov|mp3|mp4|ogg|opus|pdf|png|ppt|pptx|rar|rtf|svg|tar|txt|wav|webm|webp|xls|xlsx|xml|zip'.split('|').indexOf(extension)>=0;
    }catch(e){return false}
  }
  function buildSource(event){
    var element=closestFromEvent(event,'img,a[href],video,audio,source');
    if(!element)return null;
    var tag=String(element.tagName||'').toLowerCase();
    var sourceUrl='';
    var sourceKind='unknown';
    var mimeType='';
    var suggestedFileName='';
    if(tag==='img'){
      sourceUrl=normalizeUrl(element.currentSrc||element.getAttribute('data-src')||element.getAttribute('data-original')||element.getAttribute('data-lazy-src')||element.src);
      sourceKind='image';
      mimeType=String(element.getAttribute('type')||'').trim();
      var parentLink=element.closest&&element.closest('a[href]');
      suggestedFileName=String(parentLink&&parentLink.getAttribute('download')||'').trim();
    }else if(tag==='a'){
      sourceUrl=normalizeUrl(element.href||element.getAttribute('href'));
      sourceKind='link';
      suggestedFileName=String(element.getAttribute('download')||'').trim();
      mimeType=String(element.getAttribute('type')||'').trim();
      if(!suggestedFileName&&!looksLikeFileUrl(sourceUrl))return null;
    }else{
      sourceUrl=normalizeUrl(element.currentSrc||element.src||element.getAttribute('src'));
      sourceKind='media';
      mimeType=String(element.getAttribute('type')||'').trim();
    }
    if(!sourceUrl)return null;
    if(!suggestedFileName)suggestedFileName=fileNameFromUrl(sourceUrl);
    var sessionId='page-drag-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
    return{
      capturedAt:Date.now(),
      mimeType:mimeType||undefined,
      pageUrl:String(location.href||''),
      sessionId:sessionId,
      sourceKind:sourceKind,
      sourceUrl:sourceUrl,
      suggestedFileName:suggestedFileName||undefined,
      tabId:TAB_ID
    };
  }
  document.addEventListener('dragstart',function(event){
    var source=buildSource(event);
    if(!source)return;
    try{console.info(PREFIX+JSON.stringify(source))}catch(e){}
    try{
      if(event.dataTransfer){
        event.dataTransfer.setData(DATA_TYPE,JSON.stringify({
          sessionId:source.sessionId,
          sourceUrl:source.sourceUrl,
          tabId:source.tabId
        }));
      }
    }catch(e){}
  },true);
})();`
}
