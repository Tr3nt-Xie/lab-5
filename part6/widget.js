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
    return {text:'University of Southern California, Los Angeles',label:'University of Southern California (USC)'};
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
    var title=word('name')||street||word('city')||word('country')||'Map location';
    var parts=[street,word('district'),word('city')||word('county'),word('state'),word('postcode'),word('country')];
    var detail=parts.filter(function(v,i){return v&&v!==title&&parts.indexOf(v)===i;}).join(', ');
    var key=lat+','+lon+','+title;if(seen.has(key))return null;seen.add(key);
    return {lat:lat,lon:lon,title:title,detail:detail,label:[title,detail].filter(Boolean).join(' — ').slice(0,500)};
  }).filter(Boolean).slice(0,10);
}
function placeSearchScope(scope) {
  if(scope==='world') return {id:'world',label:'Worldwide',params:{}};
  if(scope==='us') return {id:'us',label:'United States',params:{countrycode:'US'}};
  // Fixed public region, independent of member positions and the current map view.
  return {id:'la',label:'Los Angeles area',params:{countrycode:'US',bbox:'-118.95,33.65,-117.60,34.45',lat:'34.02',lon:'-118.28',zoom:'10'}};
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
  if (!a || !b || a.value === null || b.value === null || a.value === '' || b.value === '') return { issue:'Waiting for GPS' };
  if (!validPoint(lat,lon)) return { issue:'Invalid coordinates' };
  var at=numberValue(a.ts), bt=numberValue(b.ts);
  if (!at || !bt || Math.abs(at-bt)>30000) return { issue:'Timestamp mismatch' };
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
  function fields(){var c=cfg();q('.me-lat').value=c.point?c.point[0].toFixed(6):'';q('.me-lon').value=c.point?c.point[1].toFixed(6):'';q('.me-radius').value=c.radius;q('.me-selected-place').textContent=c.point?'Meeting point: '+(typeof c.label==='string'&&c.label?c.label:'Location selected on map'):'No meeting point set';}
  function message(t){q('.me-message').textContent=t;}
  if(typeof L==='undefined'){q('.me-notice').textContent='Map resources could not load. Check your connection and reopen the dashboard.';return;}
  var map=L.map(q('.me-map'),{zoomControl:true,scrollWheelZoom:true}).setView(s.real.point||[34.03,-118.28],13);s.map=map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map).on('tileerror',function(){message('Map tiles are unavailable. Team status and distance calculations still work.');});
  L.control.scale({imperial:false}).addTo(map);
  function request(obs){return new Promise(function(resolve,reject){var sub,done=false;var pending={cancel:null};function finish(err,v){if(done)return;done=true;clearTimeout(timeout);s.pending=s.pending.filter(function(x){return x!==pending;});if(sub)sub.unsubscribe();if(err)reject(err);else resolve(v);}var timeout=setTimeout(function(){finish({status:0});},12000);pending.cancel=function(){finish({status:0});};s.pending.push(pending);sub=obs.subscribe(function(v){finish(null,v);},function(e){finish(e||{status:0});});});}
  var ds,ts;
  try{var injector=self.ctx.$scope.$injector;ds=injector.get(self.ctx.servicesMap.get('deviceService'));ts=injector.get(self.ctx.servicesMap.get('attributeService'));}catch(e){message('Cannot access platform data. Sign in as a tenant administrator.');}
  function errorText(e){return e&&e.status===401?'Session expired':e&&e.status===403?'Access denied':e&&e.status===404?'Device not found':'Read failed';}
  async function readMember(m){try{if(!ds||!ts)throw {status:403};if(!s.ids[m.device]){var device=await request(ds.findByName(m.device));s.ids[m.device]=device.id;}if(s.dead)return;var data=await request(ts.getEntityTimeseriesLatest(s.ids[m.device],['lat','lon','tst','batt']));s.reads[m.device]=parseLocation(data);}catch(e){if(!s.dead)s.reads[m.device]={issue:errorText(e),error:true};}}
  async function poll(){if(s.dead||s.demo||s.busy)return;s.busy=true;q('.me-refresh').disabled=true;await Promise.all(members.map(readMember));if(s.dead)return;s.lastCheck=Date.now();s.busy=false;q('.me-refresh').disabled=false;draw();if(!s.autoFit&&s.views.some(function(v){return v.point;})){fit();s.autoFit=true;}}
  function demoReading(i){var p=demoLocation(s.demoOrigins[i],s.demoConfig.point,i,Date.now()-s.demoStart);return {lat:p[0],lon:p[1],ts:Date.now(),batt:[84,67,92][i]};}
  function captureDemoPositions(){if(s.demo&&s.demoOrigins){var now=Date.now();s.demoOrigins=s.demoOrigins.map(function(p,i){return demoLocation(p,s.demoConfig.point,i,now-s.demoStart);});s.demoStart=now;}}
  function resetDemoMotion(){var anchor=s.demoConfig.point||s.demoAnchor,offsets=[[.003,-.0022],[.00025,.0002],[-.0028,.0038]];s.demoOrigins=offsets.map(function(p){return [anchor[0]+p[0],anchor[1]+p[1]];});s.demoStart=Date.now();}
  function distanceLabel(d){return d===null?'—':d>=1000?(d/1000).toFixed(2)+' km':Math.round(d)+' m';}
  function ageLabel(ms){if(ms< -30000)return 'Invalid time';var sec=Math.floor(Math.max(0,ms)/1000);return sec<60?sec+' s ago':sec<3600?Math.floor(sec/60)+' min ago':sec<86400?Math.floor(sec/3600)+' h ago':Math.floor(sec/86400)+' d ago';}
  function draw(){if(s.dead)return;var c=cfg(),now=Date.now(),arrived=0,valid=0,fresh=0;
    root.classList.toggle('is-demo',s.demo);q('.me-mode').textContent=s.demo?'Simulated data':'Live data';q('.me-demo').textContent=s.demo?'Back to live data':'Demo mode';q('.me-refresh').textContent=s.demo?'Restart demo':'Refresh';
    if(c.point){if(!s.meetMarker){s.meetMarker=L.marker(c.point,{icon:L.divIcon({className:'me-marker',html:'<span style="background:#147b6b">★</span>',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map).bindTooltip('Meeting point');s.circle=L.circle(c.point,{radius:c.radius,color:'#147b6b',weight:2,fillOpacity:.09}).addTo(map);}s.meetMarker.setLatLng(c.point);s.circle.setLatLng(c.point).setRadius(c.radius);}else{if(s.meetMarker){map.removeLayer(s.meetMarker);map.removeLayer(s.circle);s.meetMarker=null;s.circle=null;}}
    s.views=members.map(function(m,i){var p=s.demo?demoReading(i):(s.reads[m.device]||{issue:'Loading'}),point=validPoint(p.lat,p.lon)?[p.lat,p.lon]:null,d=point&&c.point?distanceMeters(point,c.point):null,age=point?now-p.ts:null,stale=point&&(age>120000||age< -30000),kind='waiting',label=p.issue||'Waiting for GPS';
      if(point){valid++;if(stale){kind='stale';label=age<0?'Invalid time':'Stale data';}else{fresh++;kind=c.point?(d<=c.radius?'arrived':'moving'):'waiting';label=c.point?(d<=c.radius?'Arrived':'Not arrived'):'No meeting point';if(kind==='arrived')arrived++;}}
      if(p.error)kind='error';
      var meta=point?'Updated: '+ageLabel(age)+(p.batt!==null&&p.batt>=0&&p.batt<=100?' · Battery '+Math.round(p.batt)+'%':''):(p.error?'Check the connection or sign-in status':'Waiting for OwnTracks lat / lon');
      var card='<div class="me-card" style="--member:'+m.color+'" data-member="'+i+'" role="button" tabindex="0" aria-label="View '+m.name+' location"><div class="me-card-top"><span class="me-name">'+m.name+'</span><span class="me-badge '+kind+'">'+label+'</span></div><div class="me-device">'+m.device+'</div><div class="me-distance">'+distanceLabel(d)+'<small>to meeting point</small></div><div class="me-meta">'+meta+'</div></div>';
      if(point){if(!s.markers[m.device])s.markers[m.device]=L.marker(point,{icon:L.divIcon({className:'me-marker',html:'<span style="background:'+m.color+'">'+m.short+'</span>',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map).bindTooltip(m.name,{direction:'top'});s.markers[m.device].setLatLng(point).setOpacity(stale?.45:1).bindPopup('<b>'+m.name+'</b><br>'+label+'<br>Distance to meeting point: '+distanceLabel(d)+'<br>'+meta+(s.demo?'<br><b>Simulated data</b>':''));}else if(s.markers[m.device]){map.removeLayer(s.markers[m.device]);delete s.markers[m.device];}
      return {point:point,html:card};});
    q('.me-members').innerHTML=s.views.map(function(v){return v.html;}).join('');q('.me-count').textContent=c.point?arrived+' / 3 arrived':'No meeting point';q('.me-clear').disabled=!c.point;
    q('.me-notice').textContent=s.demo?'Demo mode: all phone locations are simulated and move straight to the meeting point. Motion is accelerated, not a travel-time estimate. Nothing is written to ThingsBoard.':valid===0?'Waiting for live locations: none of the three phones has usable coordinates. Set a meeting point or select “Demo mode” to preview.':'Live data: '+fresh+' / 3 locations updated within 2 minutes. '+(valid>fresh?'Stale locations are shown for reference and excluded from the arrival count.':'');
    q('.me-last').textContent=s.demo?(c.point?(now-s.demoStart>=60000?'Demo complete · Everyone has arrived · Select “Restart demo” to replay':'Demo updates every second · Everyone arrives in about 60 seconds · Select “Restart demo” to replay'):'Demo paused · Set a meeting point to resume'):s.lastCheck?'Last checked: '+new Date(s.lastCheck).toLocaleTimeString('en-US')+' · Checked every 5 seconds':'Reading platform data…';
  }
  function fit(){var points=s.views.filter(function(v){return v.point;}).map(function(v){return v.point;});if(cfg().point)points.push(cfg().point);if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[45,45],maxZoom:17});else message('No locations yet. Set a meeting point or enable demo mode.');}
  function stopPicking(){s.picking=false;q('.me-pick').textContent='Pick on map';q('.me-pick').setAttribute('aria-pressed','false');q('.me-map').style.cursor='';}
  function inputRadius(){return q('.me-radius').validity.badInput?null:resolveRadius(q('.me-radius').value,cfg().radius);}
  function setPoint(lat,lon,radius,label){
    if(radius===null||radius<10||radius>10000){message('Arrival radius must be 10–10,000 meters. Leave it blank to keep the current radius.');return false;}
    if(!validPoint(lat,lon)){message('Enter valid coordinates or click “Pick on map” to choose a location.');return false;}
    var previous=cfg().point,replacing=!!previous,same=previous&&Math.abs(previous[0]-lat)<0.000001&&Math.abs(previous[1]-lon)<0.000001;
    if(s.demo&&!same)captureDemoPositions();
    cfg().label=typeof label==='string'?label:(same?cfg().label||'':'');cfg().point=[lat,lon];cfg().radius=radius;stopPicking();hideSearch();persist();fields();draw();
    message((s.demo?'Demo meeting point':'Meeting point')+(replacing?' replaced: ':' set: ')+lat.toFixed(6)+', '+lon.toFixed(6)+'; radius '+radius+' m. '+(s.demo?'Simulated members move from their current positions to the meeting point.':'Search again or pick on the map to change it. Settings are saved in this browser.'));
    return true;
  }
  q('.me-apply').onclick=function(){if(setPoint(numberValue(q('.me-lat').value),numberValue(q('.me-lon').value),inputRadius()))fit();};
  q('.me-pick').onclick=function(){
    hideSearch();
    if(s.picking){stopPicking();message('Map selection canceled. The meeting point is unchanged.');return;}
    var r=inputRadius();if(r===null){message('Set an arrival radius of 10–10,000 meters, or leave it blank to keep the current radius.');return;}
    q('.me-radius').value=r;s.picking=true;q('.me-pick').textContent='Cancel selection';q('.me-pick').setAttribute('aria-pressed','true');q('.me-map').style.cursor='crosshair';
    message('Click a location on the map to '+(cfg().point?'replace the meeting point':'set the meeting point')+'; no need to clear the coordinates. Radius: '+r+' m. ');
  };
  map.on('click',function(e){if(s.picking&&setPoint(e.latlng.lat,e.latlng.lng,inputRadius())&&s.demo)fit();});
  q('.me-clear').onclick=function(){stopPicking();hideSearch();captureDemoPositions();cfg().point=null;cfg().label='';persist();fields();draw();message((s.demo?'Demo meeting point':'Meeting point')+' cleared. Phone locations remain visible; distance and arrival calculations are paused. '+(s.demo?'Demo motion is paused. Set a new meeting point to resume.':'Search for a place or click “Pick on map” to set another meeting point.'));};
  q('.me-fit').onclick=fit;q('.me-refresh').onclick=function(){if(s.demo){resetDemoMotion();draw();fit();message('Demo starting positions have been reset. '+(cfg().point?'Members are moving toward the meeting point.':'Set a meeting point to start moving.'));}else poll();};
  q('.me-demo').onclick=function(){s.demo=!s.demo;stopPicking();hideSearch();if(s.demo){s.demoAnchor=s.real.point?s.real.point.slice():[34.0205,-118.2856];s.demoConfig={point:s.demoAnchor.slice(),radius:s.real.radius,label:s.real.point?s.real.label||'':'Demo meeting point'};resetDemoMotion();}fields();draw();fit();message(s.demo?'Simulated members are moving toward the meeting point. Changing it redirects them from their current positions. Returning to live data restores the original meeting point.':'Back to live data. Search for a place or click “Pick on map” to change the meeting point.');if(!s.demo)poll();};
  // Debounced search sends only query text and a fixed public region, never member locations or credentials.
  var searchCache=new Map(),searchVersion=0,searchController=null,searchTimer=null,searchAutoTimer=null,searchStarted=0,searchBusy=false;
  function searchFeedback(text){q('.me-search-feedback').textContent=text;}
  function hideSearch(){searchVersion++;if(searchController)searchController.abort();searchController=null;clearTimeout(searchTimer);clearTimeout(searchAutoTimer);searchTimer=null;searchAutoTimer=null;searchBusy=false;q('.me-search-btn').disabled=false;q('.me-search-btn').textContent='Search';q('.me-search-panel').hidden=true;q('.me-query').setAttribute('aria-expanded','false');}
  function showResults(places,search,scope){
    var list=q('.me-search-results');list.replaceChildren();q('.me-search-panel').hidden=!places.length;q('.me-query').setAttribute('aria-expanded',String(!!places.length));
    if(!places.length){searchFeedback('No matching places in “'+scope.label+'”. '+(scope.id!=='world'?'Try a broader search area. ':'')+'Add a street address or pick a location on the map.');return;}
    places.forEach(function(place){var button=document.createElement('button'),title=document.createElement('strong'),detail=document.createElement('small');button.type='button';button.className='me-result';title.textContent=place.title;detail.textContent=place.detail||'Select this meeting point';button.appendChild(title);button.appendChild(detail);button.setAttribute('aria-label','Set meeting point: '+place.label);button.onfocus=function(){button.classList.add('is-active');};button.onblur=function(){button.classList.remove('is-active');};button.onclick=function(){if(setPoint(place.lat,place.lon,inputRadius(),place.label)){q('.me-query').value=place.title;searchFeedback('Meeting point selected. Search again to change it.');if(s.demo)fit();else map.setView([place.lat,place.lon],16);}else searchFeedback('Check the coordinate or radius message below first.');};list.appendChild(button);});
    searchFeedback((search.label?'Searching for “'+search.label+'”. ':'')+scope.label+' · '+places.length+' results. Check the address before selecting.');
  }
  function queueSearch(delay){clearTimeout(searchAutoTimer);searchAutoTimer=setTimeout(searchPlaces,delay);}
  async function searchPlaces(){
    clearTimeout(searchAutoTimer);searchAutoTimer=null;
    var query=q('.me-query').value.trim().replace(/\s+/g,' ');
    if(query.length<2){hideSearch();searchFeedback('Enter at least 2 characters of a place name or address.');return;}
    if(query.length>200){searchFeedback('Search text is too long. Use no more than 200 characters.');return;}
    if(searchBusy)return;
    var search=placeSearchQuery(query),scope=placeSearchScope(q('.me-search-scope').value),key=scope.id+'|'+search.text.toLowerCase();if(searchCache.has(key)){hideSearch();showResults(searchCache.get(key),search,scope);return;}
    var delay=1200-(Date.now()-searchStarted);if(delay>0){searchFeedback('Preparing search…');queueSearch(delay);return;}
    hideSearch();stopPicking();var version=searchVersion;searchBusy=true;searchStarted=Date.now();searchController=new AbortController();var controller=searchController;
    q('.me-search-btn').disabled=true;q('.me-search-btn').textContent='Searching…';searchFeedback('Searching in '+scope.label+'…');searchTimer=setTimeout(function(){controller.abort();},12000);
    try{
      var endpoint=self.ctx.settings&&self.ctx.settings.photonUrl||'https://photon.komoot.io/api/';
      var response=await fetch(placeSearchUrl(endpoint,search,scope),{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok){var err=new Error('Search request failed');err.status=response.status;throw err;}
      var places=rankPlaceResults(parsePlaceResults(await response.json()),search.text);if(s.dead||version!==searchVersion)return;
      if(searchCache.size>=30)searchCache.delete(searchCache.keys().next().value);searchCache.set(key,places);showResults(places,search,scope);
    }catch(e){if(!s.dead&&version===searchVersion)searchFeedback(e&&e.status===429?'Search is busy. Try again later or pick a location on the map.':e&&e.name==='AbortError'?'Search timed out. Try again or pick a location on the map.':'Search is unavailable. Check your connection and retry, or pick a location on the map.');}
    finally{if(version===searchVersion){clearTimeout(searchTimer);searchTimer=null;searchController=null;searchBusy=false;if(!s.dead){q('.me-search-btn').disabled=false;q('.me-search-btn').textContent='Search';}}}
  }
  q('.me-search-btn').onclick=searchPlaces;
  q('.me-query').onkeydown=function(e){
    if(e.isComposing)return;
    if(e.key==='Enter'){e.preventDefault();searchPlaces();}
    else if(e.key==='Escape'){hideSearch();searchFeedback('Search results closed.');}
    else if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!q('.me-search-panel').hidden){var buttons=q('.me-search-results').querySelectorAll('.me-result');if(buttons.length){e.preventDefault();buttons[e.key==='ArrowDown'?0:buttons.length-1].focus();}}
  };
  function changedQuery(e){hideSearch();if(e&&e.isComposing)return;var value=q('.me-query').value.trim();searchFeedback('Search area: '+placeSearchScope(q('.me-search-scope').value).label+'. Suggestions appear after you stop typing.');if(value.length>=3||(value.length>=2&&/[\u3400-\u9fff]/.test(value)))queueSearch(1000);}
  q('.me-query').oninput=changedQuery;q('.me-query').oncompositionend=changedQuery;
  q('.me-search-scope').onchange=function(){hideSearch();if(q('.me-query').value.trim().length>=2)searchPlaces();else searchFeedback('Search area changed to '+placeSearchScope(q('.me-search-scope').value).label+'.');};
  q('.me-search-results').onkeydown=function(e){var buttons=Array.from(q('.me-search-results').querySelectorAll('.me-result')),index=buttons.indexOf(e.target.closest('.me-result'));if(e.key==='Escape'){e.preventDefault();hideSearch();q('.me-query').focus();searchFeedback('Search results closed.');}else if(index>=0&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}};
  q('.me-search-close').onclick=function(){hideSearch();searchFeedback('Search results closed. The meeting point is unchanged.');};
  function focusMember(e){var card=e.target.closest('.me-card');if(card){var v=s.views[Number(card.getAttribute('data-member'))];if(v&&v.point)map.setView(v.point,17);}}
  q('.me-members').onclick=focusMember;q('.me-members').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();focusMember(e);}};
  fields();draw();poll();s.pollTimer=setInterval(poll,5000);s.drawTimer=setInterval(draw,1000);s.resizeTimer=setTimeout(function(){if(!s.dead)map.invalidateSize();},200);
  s.destroy=function(){s.dead=true;searchVersion++;if(searchController)searchController.abort();clearTimeout(searchTimer);clearTimeout(searchAutoTimer);clearInterval(s.pollTimer);clearInterval(s.drawTimer);clearTimeout(s.resizeTimer);s.pending.slice().forEach(function(p){p.cancel();});map.remove();};
};
self.onResize=function(){if(self._meetup&&self._meetup.map&&!self._meetup.dead)self._meetup.map.invalidateSize();};
self.onDestroy=function(){if(self._meetup&&self._meetup.destroy)self._meetup.destroy();};
self.typeParameters=function(){return {datasourcesOptional:true,dataKeysOptional:true};};
