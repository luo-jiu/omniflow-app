export const EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX = '__OMNIFLOW_CREDENTIAL__:'

export function createCredentialDetectionScript(): string {
  const prefix = EMBEDDED_BROWSER_CREDENTIAL_CONSOLE_PREFIX
  return `(function(){
  if(window.__OMNIFLOW_CREDENTIAL_DETECTION__)return;
  window.__OMNIFLOW_CREDENTIAL_DETECTION__=true;
  var PREFIX=${JSON.stringify(prefix)};
  var USERNAME_PATTERN=/user|email|login|account|phone|name|identifier|usr|uname/i;
  var lastSent='';
  var lastSentAt=0;
  function findPasswordFields(root){
    try{return Array.from((root||document).querySelectorAll('input[type="password"]'))}catch(e){return[]}
  }
  function findUsernameField(passwordField){
    var form=passwordField.closest('form');
    var container=form||passwordField.parentElement&&passwordField.parentElement.parentElement||document;
    var candidates=[];
    try{candidates=Array.from(container.querySelectorAll('input[type="email"],input[type="text"],input[type="tel"]'))}catch(e){return null}
    var scored=candidates.filter(function(input){
      if(input===passwordField||input.type==='hidden')return false;
      var rect=input.getBoundingClientRect();
      if(rect.width===0&&rect.height===0)return false;
      return true;
    }).map(function(input){
      var score=0;
      var attrs=(input.name||'')+'|'+(input.id||'')+'|'+(input.getAttribute('autocomplete')||'')+'|'+(input.getAttribute('aria-label')||'')+'|'+(input.placeholder||'');
      if(USERNAME_PATTERN.test(attrs))score+=10;
      if(input.type==='email')score+=5;
      if(form&&form.contains(input)){
        var inputs=Array.from(form.querySelectorAll('input'));
        var pwIdx=inputs.indexOf(passwordField);
        var myIdx=inputs.indexOf(input);
        if(myIdx>=0&&pwIdx>=0&&myIdx<pwIdx)score+=3;
      }
      return{el:input,score:score};
    });
    scored.sort(function(a,b){return b.score-a.score});
    return scored.length?scored[0].el:null;
  }
  function sendCredential(username,password){
    if(!username||!password)return;
    var key=username+'\\n'+password;
    var now=Date.now();
    if(key===lastSent&&now-lastSentAt<3000)return;
    lastSent=key;
    lastSentAt=now;
    var domain='';
    try{domain=location.hostname}catch(e){}
    var pageUrl='';
    try{pageUrl=location.href}catch(e){}
    console.info(PREFIX+JSON.stringify({username:username,password:password,domain:domain,pageUrl:pageUrl}));
  }
  function captureFromPasswordField(pwField){
    var usernameField=findUsernameField(pwField);
    var username=usernameField?usernameField.value:'';
    var password=pwField.value;
    sendCredential(username,password);
  }
  function handleSubmit(event){
    var form=event.target;
    var pwFields=findPasswordFields(form);
    pwFields.forEach(function(pwField){captureFromPasswordField(pwField)});
  }
  function handleClick(event){
    var btn=event.target.closest('button[type="submit"],input[type="submit"],button:not([type])');
    if(!btn)return;
    var form=btn.closest('form');
    if(!form)return;
    var pwFields=findPasswordFields(form);
    pwFields.forEach(function(pwField){captureFromPasswordField(pwField)});
  }
  function observePasswordFields(){
    document.addEventListener('submit',handleSubmit,true);
    document.addEventListener('click',handleClick,true);
  }
  function scanAndObserve(){
    observePasswordFields();
    try{
      var observer=new MutationObserver(function(){});
      observer.observe(document.documentElement||document.body||document,{childList:true,subtree:true});
    }catch(e){}
  }
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',scanAndObserve);
  }else{
    scanAndObserve();
  }
})();`
}
