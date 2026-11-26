'use strict';
(() => {
  const $ = s => document.querySelector(s);
  let token = '', team = '', generation = 0, selected = '', mediaURL = '', pending = null, mediaSequence = 0;
  let busy = false, refreshing = false, connected = false, workerOnline = false;
  const configured = window.ReactManipPortal?.apiOrigin || '';
  const sameTunnel = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(location.origin);
  const origin = configured || (sameTunnel ? location.origin : '');
  const valid = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin);
  const labels = {QUEUED:'排队中',RUNNING:'评测中',ARCHIVING:'归档中',COMPLETED:'已完成',FAILED:'失败',CANCELLED:'已取消'};
  const errors = {login_failed:'账户名或密码不正确。',login_required:'登录已过期，请重新登录。',
    workstation_offline:'工作站暂未连接，请确认后台进程正在运行。',queue_full:'队列已满，请等当前评测结束。',
    login_rate_limited:'登录尝试过多，请 15 分钟后重试。',archive_not_ready:'记录和视频仍在归档，请稍后刷新。',
    full_evaluation_not_enabled:'请先完成连接验收和 OSS 独立校验。',idempotency_conflict:'提交内容已改变，请重新提交。'};
  function clearMedia() {
    mediaSequence++;
    const player = $('#player'); player.pause(); player.removeAttribute('src'); player.load(); player.hidden = true;
    $('#download').hidden = true; $('#download').removeAttribute('href');
    if (mediaURL) URL.revokeObjectURL(mediaURL); mediaURL = '';
  }
  function signedOut() {
    token=''; team=''; generation++; selected=''; pending=null; clearMedia();
    $('#logout').hidden=true; $('#login').hidden=false; $('#detail').hidden=true;
    $('#jobs').replaceChildren(document.createTextNode('登录后显示评测记录。'));
    for (const selector of ['#episodes','#videos','#facts']) $(selector).replaceChildren();
    $('#detail-state').textContent=''; $('#media-state').textContent=''; rendered='';
    $('#account').textContent='使用部署时创建的团队账户。刷新页面后需要重新登录。'; controls();
  }
  function controls() {
    $('#login button').disabled=!connected || busy;
    $('#submit-controls').disabled=!token || !connected || !workerOnline || busy;
    $('#refresh').disabled=!token || busy;
  }
  async function api(path, options={}) {
    if (!valid) throw new Error('服务地址尚未配置。');
    const headers = {...(options.headers || {})};
    const requestToken=token;
    if (requestToken) headers.Authorization='Bearer '+requestToken;
    if (options.body) headers['Content-Type']='application/json';
    const response=await fetch(origin+path,{...options,headers,credentials:'omit',cache:'no-store',redirect:'error'});
    if (!response.ok) {
      const value=await response.json().catch(()=>({}));
      if (value.error==='login_required' && token===requestToken) signedOut();
      throw new Error(errors[value.error] || `请求未完成（${value.error || response.status}）。`);
    }
    return options.video ? response.blob() : response.json();
  }
  async function health() {
    try {
      const state=await api('/api/health');
      if(state.service!=='react-manip-web-evaluation') throw new Error('服务类型不匹配。');
      connected=true; workerOnline=state.workstation_online;
      $('#service').textContent=workerOnline?'服务已连接，可以登录并提交评测。':'网页服务已连接，等待工作站上线。';
      if (!$('#task').options.length) for(const task of state.tasks) $('#task').add(new Option(task,task));
      $('#full-option').disabled=!state.full_enabled;
    } catch(error) {connected=false;workerOnline=false;$('#service').textContent=valid?'暂时无法连接评测服务，请稍后重试。':'评测入口已准备，等待配置服务地址。';}
    controls();
  }
  $('#login').addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;busy=true;controls();
    const form=new FormData(e.target);const stamp=generation;
    try {
      const r=await api('/api/login',{method:'POST',body:JSON.stringify({team:form.get('team'),password:form.get('password')})});
      if(stamp!==generation)return;
      token=r.token;team=r.team;generation++;$('#login').hidden=true;$('#logout').hidden=false;
      try {pending=JSON.parse(sessionStorage.getItem('rm.pending:'+origin+':'+team) || 'null');} catch {pending=null;}
      $('#account').textContent='已登录：'+team;await refresh();
    } catch(error) {$('#account').textContent=error.message;}
    finally {e.target.elements.password.value='';busy=false;controls();}
  });
  $('#logout').addEventListener('click',()=>{api('/api/logout',{method:'POST',body:'{}'}).catch(()=>{});signedOut();});
  $('#mode').addEventListener('change',()=>{
    const full=$('#mode').value==='full';$('#task').disabled=full;
    $('#scope').textContent=full?'完整评测会运行 720 回合，可能持续数小时并消耗较多模型额度。':'连接验收会真实调用模型、运行 GPU 仿真并保存视频。它不产生完整基准评分，模型推理可能需要几分钟。';
  });
  $('#submit').addEventListener('submit',async e=>{
    e.preventDefault();if(busy || !token)return;busy=true;controls();const stamp=generation;
    const body=JSON.stringify({model:'gpt-6-astra',reasoning:'high',mode:$('#mode').value,task:$('#task').value});
    if(!pending || pending.body!==body) pending={body,id:crypto.randomUUID()};
    try {sessionStorage.setItem('rm.pending:'+origin+':'+team,JSON.stringify(pending));} catch {}
    $('#submission-state').textContent='正在提交…';
    try {
      const r=await api('/api/evaluations',{method:'POST',body,headers:{'Idempotency-Key':pending.id}});
      if(stamp!==generation)return;pending=null;selected=r.id;
      try {sessionStorage.removeItem('rm.pending:'+origin+':'+team);} catch {}
      $('#submission-state').textContent='评测已提交：'+r.id;await refresh();
    } catch(error) {if(stamp===generation)$('#submission-state').textContent=error.message+' 可重试本次提交。';}
    finally {busy=false;controls();}
  });
  function node(tag,text,cls) {const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
  async function refresh() {
    if(!token || refreshing)return;refreshing=true;const stamp=generation;
    try {
      const r=await api('/api/evaluations');if(stamp!==generation)return;
      $('#jobs').replaceChildren();
      if(!r.items.length)$('#jobs').append(node('p','还没有评测记录。'));
      for(const job of r.items) {
        const button=node('button','','job');button.type='button';
        button.append(node('strong',`${job.spec.model} · ${job.spec.reasoning} · ${job.spec.mode==='acceptance'?'连接验收':'完整评测'}`),
          node('span',`${labels[job.status] || job.status} · ${new Date(job.created*1000).toLocaleString()} · ${job.progress.episodes_completed || job.result.episodes_completed || 0}/${job.spec.episodes_total} 回合`));
        button.addEventListener('click',()=>{selected=job.id;clearMedia();show(job).catch(e=>$('#detail-state').textContent=e.message);});
        $('#jobs').append(button);
      }
      const job=r.items.find(j=>j.id===selected);if(job)await show(job);
    } catch(error) {if(stamp===generation)$('#submission-state').textContent=error.message;}
    finally {refreshing=false;}
  }
  let rendered='';
  async function show(job) {
    const stamp=generation;$('#detail').hidden=false;$('#detail-title').textContent='评测 '+job.id;
    $('#detail-state').textContent=(labels[job.status] || job.status)+(job.result.error_code?' · '+job.result.error_code:'');
    $('#cancel').hidden=['COMPLETED','FAILED','CANCELLED'].includes(job.status);
    $('#facts').replaceChildren();
    for(const [label,value] of [['GPU 仿真',job.result.gpu_verified],['归档校验',job.result.archive_verified],['OSS 独立读取',job.result.remote_verified]])
      $('#facts').append(node('span',label+'：'+(value?'已通过':'待完成'),'fact'));
    if(!job.archive_commit){$('#videos').replaceChildren();$('#episodes').replaceChildren();rendered='';return;}
    const key=job.id+':'+job.archive_commit;
    if(rendered===key)return;
    const record=await api('/api/evaluations/'+job.id+'/record');
    if(stamp!==generation || selected!==job.id)return;
    rendered=key;$('#episodes').replaceChildren();$('#videos').replaceChildren();
    const table=document.createElement('table');const head=document.createElement('tr');
    for(const t of ['任务','阶段','耗时','结果'])head.append(node('th',t));table.append(head);
    for(const e of record.episodes){const tr=document.createElement('tr');for(const v of [e.task,e.phase,typeof e.wall_time_sec==='number'?e.wall_time_sec.toFixed(1)+' 秒':'—',e.error_code || (e.passed?'任务成功':'回合完成')])tr.append(node('td',String(v)));table.append(tr);}
    $('#episodes').append(table);
    for(const [index,v] of record.artifacts.entries()){
      const b=node('button',`播放视频 ${index+1} · ${(v.size/1048576).toFixed(1)} MB`);b.type='button';
      b.addEventListener('click',async()=>{
        const g=generation;const eid=selected;clearMedia();const mediaRequest=mediaSequence;$('#media-state').textContent='正在读取归档视频…';b.disabled=true;
        try{
          const blob=await api(`/api/evaluations/${job.id}/videos/${v.id}`,{video:true});
          if(g!==generation || eid!==selected || mediaRequest!==mediaSequence)return;
          mediaURL=URL.createObjectURL(blob);$('#player').src=mediaURL;$('#player').hidden=false;
          $('#download').href=mediaURL;$('#download').download=v.id+'.mp4';$('#download').textContent='下载当前视频';$('#download').hidden=false;
          $('#media-state').textContent='视频已从归档读取。';$('#player').play().catch(()=>{});
        }catch(e){if(g===generation && mediaRequest===mediaSequence)$('#media-state').textContent=e.message;}finally{b.disabled=false;}
      });$('#videos').append(b);
    }
  }
  $('#cancel').addEventListener('click',async()=>{try{await api('/api/evaluations/'+selected+'/cancel',{method:'POST',body:'{}'});await refresh();}catch(e){$('#detail-state').textContent=e.message;}});
  $('#refresh').addEventListener('click',refresh);
  window.addEventListener('pagehide',clearMedia);
  health();setInterval(()=>{health();refresh();},7000);
})();
