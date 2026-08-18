import { LIBRARY_FILE_BROWSER_DRAG_DATA_TYPE } from '../../src/features/file-transfer/model/file-transfer'

export const EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX = '__OMNIFLOW_LIBRARY_FILE_DROP__:'
export const EMBEDDED_BROWSER_LIBRARY_FILE_DROP_ACCEPTANCE_KEY = '__OMNIFLOW_LIBRARY_FILE_DROP_ACCEPTED__'
export const EMBEDDED_BROWSER_LIBRARY_FILE_DROP_WORLD_ID = 1004

export function createEmbeddedBrowserLibraryFileDropScript(nonce: string): string {
  return `(function(){
  if(window.__OMNIFLOW_LIBRARY_FILE_DROP__)return;
  window.__OMNIFLOW_LIBRARY_FILE_DROP__=true;
  var DATA_TYPE=${JSON.stringify(LIBRARY_FILE_BROWSER_DRAG_DATA_TYPE)};
  var PREFIX=${JSON.stringify(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_CONSOLE_PREFIX)};
  var NONCE=${JSON.stringify(nonce)};
  var ACCEPTANCE_KEY=${JSON.stringify(EMBEDDED_BROWSER_LIBRARY_FILE_DROP_ACCEPTANCE_KEY)};
  window[ACCEPTANCE_KEY]=false;
  function hasLibraryFile(event){
    try{
      if(!event||event.isTrusted!==true)return false;
      var types=Array.from(event.dataTransfer&&event.dataTransfer.types||[]);
      return types.map(function(value){return String(value||'').toLowerCase()}).indexOf(DATA_TYPE)>=0;
    }catch(error){return false}
  }
  function parsePayload(event){
    try{
      var raw=event.dataTransfer&&event.dataTransfer.getData(DATA_TYPE);
      if(!raw||raw.length>4096)return null;
      var payload=JSON.parse(raw);
      var claimId=String(payload&&payload.claimId||'').trim();
      var fileName=String(payload&&payload.fileName||'').trim();
      var mimeType=String(payload&&payload.mimeType||'').trim();
      if(!/^[a-zA-Z0-9_-]{16,128}$/.test(claimId)||!fileName)return null;
      return{claimId:claimId,fileName:fileName,mimeType:mimeType||undefined};
    }catch(error){return null}
  }
  function resolveTopPoint(event){
    var x=Number(event.clientX||0);
    var y=Number(event.clientY||0);
    try{
      var currentWindow=window;
      while(currentWindow!==currentWindow.top){
        var frameElement=currentWindow.frameElement;
        if(!frameElement)return{x:x,y:y,supported:false};
        var rect=frameElement.getBoundingClientRect();
        x+=rect.left;
        y+=rect.top;
        currentWindow=currentWindow.parent;
      }
    }catch(error){return{x:x,y:y,supported:false}}
    return{x:Math.max(0,x),y:Math.max(0,y),supported:true};
  }
  function allowDrop(event){
    if(!hasLibraryFile(event))return;
    event.preventDefault();
    try{event.dataTransfer.dropEffect='copy'}catch(error){}
  }
  function trackNativeFileAcceptance(event){
    try{
      if(!event||event.isTrusted!==true)return;
      var types=Array.from(event.dataTransfer&&event.dataTransfer.types||[]);
      var hasFiles=types.some(function(value){return String(value||'').toLowerCase()==='files'});
      if(!hasFiles)return;
      Promise.resolve().then(function(){window[ACCEPTANCE_KEY]=event.defaultPrevented===true});
    }catch(error){}
  }
  document.addEventListener('dragenter',allowDrop,true);
  document.addEventListener('dragover',allowDrop,true);
  document.addEventListener('dragover',trackNativeFileAcceptance,true);
  document.addEventListener('drop',function(event){
    if(!hasLibraryFile(event))return;
    var payload=parsePayload(event);
    if(!payload)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var point=resolveTopPoint(event);
    try{
      console.info(PREFIX+JSON.stringify({
        claimId:payload.claimId,
        clientX:point.x,
        clientY:point.y,
        fileName:payload.fileName,
        frameCoordinateSupported:point.supported,
        mimeType:payload.mimeType,
        nonce:NONCE,
        pageUrl:String(location.href||'')
      }));
    }catch(error){}
  },true);
})();`
}
