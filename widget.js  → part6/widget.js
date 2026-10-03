// Lab 5 Team Meetup. Reads only the three named devices; demo data stays in memory.
function numberValue(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  var n = Number(value); return Number.isFinite(n) ? n : null;
}
function validPoint(lat, lon) { return lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }
function resolveRadius(value, current) {
  var radius = value === '' ? numberValue(current) : numberValue(value);
  return radius !== null && radius >= 10 && radius <= 10000 ? radius : null;
}
function demoLocation(origin, destination, index, elapsedMs) {
  if(!destination)return origin.slice();
  var fraction=Math.max(0,Math.min(1,elapsedMs/[48000,52000,60000][index]));
  return [origin[0]+(destination[0]-origin[0])*fraction,origin[1]+(destination[1]-origin[1])*fraction];
}
function placeSearchQuery(input) {
  var text=input.normalize('NFKC').trim().replace(/\s+/g,' '),alias=text.replace(/[.\s]/g,'').toLowerCase();
  // Campus-specific aliases expand the query, never substitute invented results or coordinates.
  if(['usc','南加州大学','南加州大學','南加大'].indexOf(alias)!==-1)
    return {text:'University of Southern California, Los Angeles',label:'南加州大学（USC）'};
  return {text:text,label:''};
}
function parsePlaceResults(raw) {
  if(!raw || !Array.isArray(raw.features)) return [];
  var seen=new Set();
  return raw.features.map(function(f){
    var g=f&&f.geometry,p=f&&f.properties||{};
    if(!g || g.type!=='Point' || !Array.isArray(g.coordinates)) return null;
    var lon=numberValue(g.coordinates[0]),lat=numberValue(g.coordinates[1]);
    if(!validPoint(lat,lon)) return null;
    function word(k){return typeof p[k]==='string'?p[k].trim().slice(0,160):'';}
    var street=[word('housenumber'),word('street')].filter(Boolean).join(' ');
    var title=word('name')||street||word('city')||word('country')||'地图地点';
    var parts=[street,word('district'),word('city')||word('county'),word('state'),word('postcode'),word('country')];
    var detail=parts.filter(function(v,i){return v&&v!==title&&parts.indexOf(v)===i;}).join(', ');
    var key=lat+','+lon+','+title;if(seen.has(key))return null;seen.add(key);
    return {lat:lat,lon:lon,title:title,detail:detail,label:[title,detail].filter(Boolean).join(' — ').slice(0,500)};
  }).filter(Boolean).slice(0,10);
}
function placeSearchScope(scope) {
  if(scope==='world') return {id:'world',label:'全球',params:{}};
  if(scope==='us') return {id:'us',label:'全美国',params:{countrycode:'US'}};
  // Fixed public region, independent of member positions and the current map view.
  return {id:'la',label:'洛杉矶及周边',params:{countrycode:'US',bbox:'-118.95,33.65,-117.60,34.45',lat:'34.02',lon:'-118.28',zoom:'10'}};
}
function placeSearchUrl(endpoint,search,scope) {
  var url=new URL(endpoint);url.searchParams.set('q',search.text);url.searchParams.set('limit','10');url.searchParams.set('lang','en');
  ['countrycode','bbox','lat','lon','zoom'].forEach(function(k){url.searchParams.delete(k);});
  Object.keys(scope.params).forEach(function(k){url.searchParams.set(k,scope.params[k]);});
  return url.toString();
}
function rankPlaceResults(places,query) {
  function normalized(text){return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
  var needle=normalized(query),tokens=needle.split(' ').filter(function(t){return t&&['the','a','an','of','and'].indexOf(t)===-1;});
  function score(p){var title=normalized(p.title);if(title===needle)return 100;if(needle&&title.startsWith(needle))return 80;if(tokens.length&&tokens.every(function(t){return title.split(' ').some(function(word){return word.startsWith(t);});}))return 60;return 0;}
  return places.map(function(p,i){return {place:p,index:i,score:score(p)};}).sort(function(a,b){return b.score-a.score||a.index-b.index;}).map(function(v){return v.place;});
}
function distanceMeters(a, b) {
  var rad = Math.PI / 180, dl = (b[0]-a[0])*rad, dn = (b[1]-a[1])*rad;
  var h = Math.sin(dl/2)*Math.sin(dl/2) + Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dn/2)*Math.sin(dn/2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1,Math.max(0,h))), Math.sqrt(1-Math.min(1,Math.max(0,h))));
}
function parseLocation(raw) {
  function first(key) { return raw && raw[key] && raw[key][0]; }
  var a=first('lat'), b=first('lon'), lat=numberValue(a && a.value), lon=numberValue(b && b.value);
  if (!a || !b || a.value === null || b.value === null || a.value === '' || b.value === '') return { issue:'等待位置上报' };
  if (!validPoint(lat,lon)) return { issue:'坐标无效' };
  var at=numberValue(a.ts), bt=numberValue(b.ts);
  if (!at || !bt || Math.abs(at-bt)>30000) return { issue:'坐标时间不一致' };
  var source=first('tst'), captured=numberValue(source && source.value), ts=Math.min(at,bt);
  if (captured && source && Math.abs(Number(source.ts)-ts)<=30000) ts=Math.min(ts,captured*1000);
  return { lat:lat, lon:lon, ts:ts, batt:numberValue(first('batt') && first('batt').value) };
}
self.onInit = function() {
  if (self._meetup && self._meetup.destroy) self._meetup.destroy();
  var root=self.ctx.$container[0].querySelector('.me-root');
  if (!root) return;
  function q(sel) { return root.querySelector(sel); }
  var members=[{device:'phone-xiaopeng',name:'Xiaopeng',short:'X',color:'#2463c5'},{device:'phone-wenxu',name:'Wenxu',short:'W',color:'#d17a22'},{device:'phone-fengmao',name:'Fengmao',short:'F',color:'#9256b8'}];
  var s={root:root,dead:false,demo:false,picking:false,busy:false,reads:{},ids:{},markers:{},views:[],pending:[],real:{point:null,radius:100},demoConfig:{point:[34.0205,-118.2856],radius:100},lastCheck:null,autoFit:false};
  self._meetup=s;
  var storageKey='ee542-lab5-meetup-v1';
  try { var saved=JSON.parse(localStorage.getItem(storageKey)||'null'); if(saved && (saved.point===null || (Array.isArray(saved.point) && validPoint(saved.point[0],saved.point[1]))) && saved.radius>=10 && saved.radius<=10000) s.real=saved; } catch(e) {}
  function cfg(){return s.demo?s.demoConfig:s.real;}
  function persist(){if(!s.demo){try{localStorage.setItem(storageKey,JSON.stringify(s.real));}catch(e){}}}
  function fields(){var c=cfg();q('.me-lat').value=c.point?c.point[0].toFixed(6):'';q('.me-lon').value=c.point?c.point[1].toFixed(6):'';q('.me-radius').value=c.radius;q('.me-selected-place').textContent=c.point?'当前集合点：'+(typeof c.label==='string'&&c.label?c.label:'地图选定位置'):'尚未设置集合点';}
  function message(t){q('.me-message').textContent=t;}
  if(typeof L==='undefined'){q('.me-notice').textContent='地图资源未加载，请检查网络后重新打开仪表板。';return;}
  var map=L.map(q('.me-map'),{zoomControl:true,scrollWheelZoom:true}).setView(s.real.point||[34.03,-118.28],13);s.map=map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map).on('tileerror',function(){message('底图暂时无法加载；成员状态和距离计算仍可使用。');});
  L.control.scale({imperial:false}).addTo(map);
  function request(obs){return new Promise(function(resolve,reject){var sub,done=false;var pending={cancel:null};function finish(err,v){if(done)return;done=true;clearTimeout(timeout);s.pending=s.pending.filter(function(x){return x!==pending;});if(sub)sub.unsubscribe();if(err)reject(err);else resolve(v);}var timeout=setTimeout(function(){finish({status:0});},12000);pending.cancel=function(){finish({status:0});};s.pending.push(pending);sub=obs.subscribe(function(v){finish(null,v);},function(e){finish(e||{status:0});});});}
  var ds,ts;
  try{var injector=self.ctx.$scope.$injector;ds=injector.get(self.ctx.servicesMap.get('deviceService'));ts=injector.get(self.ctx.servicesMap.get('attributeService'));}catch(e){message('无法访问平台数据服务。请以租户管理员登录。');}
  function errorText(e){return e&&e.status===401?'登录已过期':e&&e.status===403?'没有读取权限':e&&e.status===404?'未找到设备':'读取失败，请重试';}
  async function readMember(m){try{if(!ds||!ts)throw {status:403};if(!s.ids[m.device]){var device=await request(ds.findByName(m.device));s.ids[m.device]=device.id;}if(s.dead)return;var data=await request(ts.getEntityTimeseriesLatest(s.ids[m.device],['lat','lon','tst','batt']));s.reads[m.device]=parseLocation(data);}catch(e){if(!s.dead)s.reads[m.device]={issue:errorText(e),error:true};}}
  async function poll(){if(s.dead||s.demo||s.busy)return;s.busy=true;q('.me-refresh').disabled=true;await Promise.all(members.map(readMember));if(s.dead)return;s.lastCheck=Date.now();s.busy=false;q('.me-refresh').disabled=false;draw();if(!s.autoFit&&s.views.some(function(v){return v.point;})){fit();s.autoFit=true;}}
  function demoReading(i){var p=demoLocation(s.demoOrigins[i],s.demoConfig.point,i,Date.now()-s.demoStart);return {lat:p[0],lon:p[1],ts:Date.now(),batt:[84,67,92][i]};}
  function captureDemoPositions(){if(s.demo&&s.demoOrigins){var now=Date.now();s.demoOrigins=s.demoOrigins.map(function(p,i){return demoLocation(p,s.demoConfig.point,i,now-s.demoStart);});s.demoStart=now;}}
  function resetDemoMotion(){var anchor=s.demoConfig.point||s.demoAnchor,offsets=[[.003,-.0022],[.00025,.0002],[-.0028,.0038]];s.demoOrigins=offsets.map(function(p){return [anchor[0]+p[0],anchor[1]+p[1]];});s.demoStart=Date.now();}
  function distanceLabel(d){return d===null?'—':d>=1000?(d/1000).toFixed(2)+' km':Math.round(d)+' m';}
  function ageLabel(ms){if(ms< -30000)return '时间异常';var sec=Math.floor(Math.max(0,ms)/1000);return sec<60?sec+' 秒前':sec<3600?Math.floor(sec/60)+' 分钟前':sec<86400?Math.floor(sec/3600)+' 小时前':Math.floor(sec/86400)+' 天前';}
  function draw(){if(s.dead)return;var c=cfg(),now=Date.now(),arrived=0,valid=0,fresh=0;
    root.classList.toggle('is-demo',s.demo);q('.me-mode').textContent=s.demo?'模拟数据':'真实数据';q('.me-demo').textContent=s.demo?'返回真实数据':'演示模式';q('.me-refresh').textContent=s.demo?'重新演示':'刷新';
    if(c.point){if(!s.meetMarker){s.meetMarker=L.marker(c.point,{icon:L.divIcon({className:'me-marker',html:'<span style="background:#147b6b">★</span>',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map).bindTooltip('集合点');s.circle=L.circle(c.point,{radius:c.radius,color:'#147b6b',weight:2,fillOpacity:.09}).addTo(map);}s.meetMarker.setLatLng(c.point);s.circle.setLatLng(c.point).setRadius(c.radius);}else{if(s.meetMarker){map.removeLayer(s.meetMarker);map.removeLayer(s.circle);s.meetMarker=null;s.circle=null;}}
    s.views=members.map(function(m,i){var p=s.demo?demoReading(i):(s.reads[m.device]||{issue:'等待读取'}),point=validPoint(p.lat,p.lon)?[p.lat,p.lon]:null,d=point&&c.point?distanceMeters(point,c.point):null,age=point?now-p.ts:null,stale=point&&(age>120000||age< -30000),kind='waiting',label=p.issue||'等待位置上报';
      if(point){valid++;if(stale){kind='stale';label=age<0?'时间异常':'数据已过期';}else{fresh++;kind=c.point?(d<=c.radius?'arrived':'moving'):'waiting';label=c.point?(d<=c.radius?'已到达':'未到达'):'未设集合点';if(kind==='arrived')arrived++;}}
      if(p.error)kind='error';
      var meta=point?'更新：'+ageLabel(age)+(p.batt!==null&&p.batt>=0&&p.batt<=100?' · 电量 '+Math.round(p.batt)+'%':''):(p.error?'检查平台连接或登录状态':'等待 OwnTracks 上传 lat / lon');
      var card='<div class="me-card" style="--member:'+m.color+'" data-member="'+i+'" role="button" tabindex="0" aria-label="查看 '+m.name+' 位置"><div class="me-card-top"><span class="me-name">'+m.name+'</span><span class="me-badge '+kind+'">'+label+'</span></div><div class="me-device">'+m.device+'</div><div class="me-distance">'+distanceLabel(d)+'<small>距集合点</small></div><div class="me-meta">'+meta+'</div></div>';
      if(point){if(!s.markers[m.device])s.markers[m.device]=L.marker(point,{icon:L.divIcon({className:'me-marker',html:'<span style="background:'+m.color+'">'+m.short+'</span>',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map).bindTooltip(m.name,{direction:'top'});s.markers[m.device].setLatLng(point).setOpacity(stale?.45:1).bindPopup('<b>'+m.name+'</b><br>'+label+'<br>距集合点：'+distanceLabel(d)+'<br>'+meta+(s.demo?'<br><b>模拟数据</b>':''));}else if(s.markers[m.device]){map.removeLayer(s.markers[m.device]);delete s.markers[m.device];}
      return {point:point,html:card};});
    q('.me-members').innerHTML=s.views.map(function(v){return v.html;}).join('');q('.me-count').textContent=c.point?arrived+' / 3 已到达':'未设集合点';q('.me-clear').disabled=!c.point;
    q('.me-notice').textContent=s.demo?'演示模式：所有手机位置均为模拟，沿直线前往集合点；速度已加快，不代表实际出行时间。不会写入 ThingsBoard。':valid===0?'等待真实位置数据：三个设备尚无可用坐标。可以先设置集合点，或点击“演示模式”预览。':'真实数据：'+fresh+' / 3 个位置在 2 分钟内更新。'+(valid>fresh?'过期位置仅供参考，不计入已到达。':'');
    q('.me-last').textContent=s.demo?(c.point?(now-s.demoStart>=60000?'模拟完成 · 全员已到达 · 点击“重新演示”可重播':'模拟位置每秒更新 · 约 60 秒全部到达 · 可点击“重新演示”'):'模拟已暂停 · 设置集合点后继续移动'):s.lastCheck?'最近检查：'+new Date(s.lastCheck).toLocaleTimeString()+' · 每 5 秒自动读取':'正在读取平台数据…';
  }
  function fit(){var points=s.views.filter(function(v){return v.point;}).map(function(v){return v.point;});if(cfg().point)points.push(cfg().point);if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[45,45],maxZoom:17});else message('暂时没有位置；可先输入集合点或启用演示模式。');}
  function stopPicking(){s.picking=false;q('.me-pick').textContent='地图选点';q('.me-pick').setAttribute('aria-pressed','false');q('.me-map').style.cursor='';}
  function inputRadius(){return q('.me-radius').validity.badInput?null:resolveRadius(q('.me-radius').value,cfg().radius);}
  function setPoint(lat,lon,radius,label){
    if(radius===null||radius<10||radius>10000){message('到达半径需在 10–10000 米之间；留空可沿用当前半径。');return false;}
    if(!validPoint(lat,lon)){message('请输入有效经纬度，或点击“地图选点”后直接选择新位置。');return false;}
    var previous=cfg().point,replacing=!!previous,same=previous&&Math.abs(previous[0]-lat)<0.000001&&Math.abs(previous[1]-lon)<0.000001;
    if(s.demo&&!same)captureDemoPositions();
    cfg().label=typeof label==='string'?label:(same?cfg().label||'':'');cfg().point=[lat,lon];cfg().radius=radius;stopPicking();hideSearch();persist();fields();draw();
    message((s.demo?'模拟集合点':'集合点')+(replacing?'已更换：':'已设置：')+lat.toFixed(6)+', '+lon.toFixed(6)+'；半径 '+radius+' 米。'+(s.demo?'模拟成员从当前位置前往集合点。':'可再次搜索或地图选点更换。设置保存在本浏览器。'));
    return true;
  }
  q('.me-apply').onclick=function(){if(setPoint(numberValue(q('.me-lat').value),numberValue(q('.me-lon').value),inputRadius()))fit();};
  q('.me-pick').onclick=function(){
    hideSearch();
    if(s.picking){stopPicking();message('已取消选点，原集合点保持不变。');return;}
    var r=inputRadius();if(r===null){message('请把到达半径设为 10–10000 米；留空可沿用当前半径。');return;}
    q('.me-radius').value=r;s.picking=true;q('.me-pick').textContent='取消选点';q('.me-pick').setAttribute('aria-pressed','true');q('.me-map').style.cursor='crosshair';
    message('请点击地图上的新位置，即可'+(cfg().point?'替换原集合点':'设置集合点')+'；无需清空经纬度。半径 '+r+' 米。');
  };
  map.on('click',function(e){if(s.picking&&setPoint(e.latlng.lat,e.latlng.lng,inputRadius())&&s.demo)fit();});
  q('.me-clear').onclick=function(){stopPicking();hideSearch();captureDemoPositions();cfg().point=null;cfg().label='';persist();fields();draw();message((s.demo?'模拟集合点':'集合点')+'已取消；手机位置保留，距离和到达状态暂不计算。'+(s.demo?'模拟移动暂停，设定新集合点后继续。':'可搜索地点或点击“地图选点”重新设置。'));};
  q('.me-fit').onclick=fit;q('.me-refresh').onclick=function(){if(s.demo){resetDemoMotion();draw();fit();message('已重置模拟成员的起始位置。'+(cfg().point?'正在前往集合点。':'设置集合点后开始移动。'));}else poll();};
  q('.me-demo').onclick=function(){s.demo=!s.demo;stopPicking();hideSearch();if(s.demo){s.demoAnchor=s.real.point?s.real.point.slice():[34.0205,-118.2856];s.demoConfig={point:s.demoAnchor.slice(),radius:s.real.radius,label:s.real.point?s.real.label||'':'演示集合点'};resetDemoMotion();}fields();draw();fit();message(s.demo?'模拟成员正前往集合点；更换地点后从当前位置转向新目标。返回真实数据后恢复原集合点。':'已返回真实数据。可搜索地点或点击“地图选点”更换集合点。');if(!s.demo)poll();};
  // Debounced search sends only query text and a fixed public region, never member locations or credentials.
  var searchCache=new Map(),searchVersion=0,searchController=null,searchTimer=null,searchAutoTimer=null,searchStarted=0,searchBusy=false;
  function searchFeedback(text){q('.me-search-feedback').textContent=text;}
  function hideSearch(){searchVersion++;if(searchController)searchController.abort();searchController=null;clearTimeout(searchTimer);clearTimeout(searchAutoTimer);searchTimer=null;searchAutoTimer=null;searchBusy=false;q('.me-search-btn').disabled=false;q('.me-search-btn').textContent='搜索地点';q('.me-search-panel').hidden=true;q('.me-query').setAttribute('aria-expanded','false');}
  function showResults(places,search,scope){
    var list=q('.me-search-results');list.replaceChildren();q('.me-search-panel').hidden=!places.length;q('.me-query').setAttribute('aria-expanded',String(!!places.length));
    if(!places.length){searchFeedback('在“'+scope.label+'”未找到匹配地点。'+(scope.id!=='world'?'可切换到更大范围；':'')+'也可补充街道地址，或在地图选点。');return;}
    places.forEach(function(place){var button=document.createElement('button'),title=document.createElement('strong'),detail=document.createElement('small');button.type='button';button.className='me-result';title.textContent=place.title;detail.textContent=place.detail||'选择此地点作为集合点';button.appendChild(title);button.appendChild(detail);button.setAttribute('aria-label','设为集合点：'+place.label);button.onfocus=function(){button.classList.add('is-active');};button.onblur=function(){button.classList.remove('is-active');};button.onclick=function(){if(setPoint(place.lat,place.lon,inputRadius(),place.label)){q('.me-query').value=place.title;searchFeedback('已选中地点，可重新搜索更换集合点。');if(s.demo)fit();else map.setView([place.lat,place.lon],16);}else searchFeedback('请先检查下方的经纬度或半径提示。');};list.appendChild(button);});
    searchFeedback((search.label?'已按“'+search.label+'”搜索。':'')+scope.label+' · '+places.length+' 个结果，请核对地址后选择。');
  }
  function queueSearch(delay){clearTimeout(searchAutoTimer);searchAutoTimer=setTimeout(searchPlaces,delay);}
  async function searchPlaces(){
    clearTimeout(searchAutoTimer);searchAutoTimer=null;
    var query=q('.me-query').value.trim().replace(/\s+/g,' ');
    if(query.length<2){hideSearch();searchFeedback('请输入至少 2 个字符的地址或地点名称。');return;}
    if(query.length>200){searchFeedback('地点名称过长，请缩短至 200 个字符以内。');return;}
    if(searchBusy)return;
    var search=placeSearchQuery(query),scope=placeSearchScope(q('.me-search-scope').value),key=scope.id+'|'+search.text.toLowerCase();if(searchCache.has(key)){hideSearch();showResults(searchCache.get(key),search,scope);return;}
    var delay=1200-(Date.now()-searchStarted);if(delay>0){searchFeedback('正在准备搜索…');queueSearch(delay);return;}
    hideSearch();stopPicking();var version=searchVersion;searchBusy=true;searchStarted=Date.now();searchController=new AbortController();var controller=searchController;
    q('.me-search-btn').disabled=true;q('.me-search-btn').textContent='搜索中…';searchFeedback('正在搜索'+scope.label+'的地点…');searchTimer=setTimeout(function(){controller.abort();},12000);
    try{
      var endpoint=self.ctx.settings&&self.ctx.settings.photonUrl||'https://photon.komoot.io/api/';
      var response=await fetch(placeSearchUrl(endpoint,search,scope),{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok){var err=new Error('Search request failed');err.status=response.status;throw err;}
      var places=rankPlaceResults(parsePlaceResults(await response.json()),search.text);if(s.dead||version!==searchVersion)return;
      if(searchCache.size>=30)searchCache.delete(searchCache.keys().next().value);searchCache.set(key,places);showResults(places,search,scope);
    }catch(e){if(!s.dead&&version===searchVersion)searchFeedback(e&&e.status===429?'搜索服务繁忙，请稍后再试，或使用地图选点。':e&&e.name==='AbortError'?'搜索超时，请重试或使用地图选点。':'暂时无法搜索地点，请检查网络后重试，或使用地图选点。');}
    finally{if(version===searchVersion){clearTimeout(searchTimer);searchTimer=null;searchController=null;searchBusy=false;if(!s.dead){q('.me-search-btn').disabled=false;q('.me-search-btn').textContent='搜索地点';}}}
  }
  q('.me-search-btn').onclick=searchPlaces;
  q('.me-query').onkeydown=function(e){
    if(e.isComposing)return;
    if(e.key==='Enter'){e.preventDefault();searchPlaces();}
    else if(e.key==='Escape'){hideSearch();searchFeedback('已关闭搜索结果。');}
    else if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!q('.me-search-panel').hidden){var buttons=q('.me-search-results').querySelectorAll('.me-result');if(buttons.length){e.preventDefault();buttons[e.key==='ArrowDown'?0:buttons.length-1].focus();}}
  };
  function changedQuery(e){hideSearch();if(e&&e.isComposing)return;var value=q('.me-query').value.trim();searchFeedback('搜索范围：'+placeSearchScope(q('.me-search-scope').value).label+'；停止输入后自动显示建议。');if(value.length>=3||(value.length>=2&&/[\u3400-\u9fff]/.test(value)))queueSearch(1000);}
  q('.me-query').oninput=changedQuery;q('.me-query').oncompositionend=changedQuery;
  q('.me-search-scope').onchange=function(){hideSearch();if(q('.me-query').value.trim().length>=2)searchPlaces();else searchFeedback('搜索范围已改为'+placeSearchScope(q('.me-search-scope').value).label+'。');};
  q('.me-search-results').onkeydown=function(e){var buttons=Array.from(q('.me-search-results').querySelectorAll('.me-result')),index=buttons.indexOf(e.target.closest('.me-result'));if(e.key==='Escape'){e.preventDefault();hideSearch();q('.me-query').focus();searchFeedback('已关闭搜索结果。');}else if(index>=0&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}};
  q('.me-search-close').onclick=function(){hideSearch();searchFeedback('已关闭搜索结果，原集合点保持不变。');};
  function focusMember(e){var card=e.target.closest('.me-card');if(card){var v=s.views[Number(card.getAttribute('data-member'))];if(v&&v.point)map.setView(v.point,17);}}
  q('.me-members').onclick=focusMember;q('.me-members').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();focusMember(e);}};
  fields();draw();poll();s.pollTimer=setInterval(poll,5000);s.drawTimer=setInterval(draw,1000);s.resizeTimer=setTimeout(function(){if(!s.dead)map.invalidateSize();},200);
  s.destroy=function(){s.dead=true;searchVersion++;if(searchController)searchController.abort();clearTimeout(searchTimer);clearTimeout(searchAutoTimer);clearInterval(s.pollTimer);clearInterval(s.drawTimer);clearTimeout(s.resizeTimer);s.pending.slice().forEach(function(p){p.cancel();});map.remove();};
};
self.onResize=function(){if(self._meetup&&self._meetup.map&&!self._meetup.dead)self._meetup.map.invalidateSize();};
self.onDestroy=function(){if(self._meetup&&self._meetup.destroy)self._meetup.destroy();};
self.typeParameters=function(){return {datasourcesOptional:true,dataKeysOptional:true};};
